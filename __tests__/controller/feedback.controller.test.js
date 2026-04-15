const feedbackController = require("../../controller/feedback.controller");
const Feedback = require("../../models/feedback.model");
const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");

jest.mock("../../models/feedback.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/billiard_table.model");

const createRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe("Feedback Controller - Unit Tests", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("createFeedback", () => {
        it("should create feedback successfully", async () => {
            const req = {
                user: { accountId: "u1" },
                body: { booking_id: "b1", rating: 5, comment: "Tuyệt vời" }
            };
            const res = createRes();

            const mockBooking = {
                _id: "b1",
                account_id: "u1",
                status: "Completed",
                table_id: { _id: "t1", club_id: "c1" }, // Giả lập đã có club_id để tránh vào nhánh BilliardTable
                populate: jest.fn().mockReturnThis()
            };
            Booking.findById.mockResolvedValue(mockBooking);
            Feedback.findOne.mockResolvedValue(null);
            Feedback.create.mockResolvedValue({ _id: "f1", ...req.body, club_id: "c1" });

            await feedbackController.createFeedback(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should return 400 for invalid rating", async () => {
            const req = { 
                user: { accountId: "u1" }, 
                body: { booking_id: "b1", rating: 6 } 
            };
            const res = createRes();
            await feedbackController.createFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("should return 403 if booking does not belong to user", async () => {
            const req = { 
                user: { accountId: "u1" }, 
                body: { booking_id: "b1", rating: 5 } 
            };
            const res = createRes();
            Booking.findById.mockResolvedValue({ _id: "b1", account_id: "u2" });
            await feedbackController.createFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe("getClubFeedbacks", () => {
        it("should return club feedbacks with pagination", async () => {
            const req = {
                params: { clubId: "c1" },
                query: { page: "1", rating: "5" },
                user: { club_id: "c1" }
            };
            const res = createRes();

            Feedback.find.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockReturnValue({
                        sort: jest.fn().mockReturnValue({
                            skip: jest.fn().mockReturnValue({
                                limit: jest.fn().mockReturnValue({
                                    lean: jest.fn().mockResolvedValue([{ _id: "f1", rating: 5 }])
                                })
                            })
                        })
                    })
                })
            });
            Feedback.countDocuments.mockResolvedValue(1);

            await feedbackController.getClubFeedbacks(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json.mock.calls[0][0].data.length).toBe(1);
        });
    });

    describe("replyFeedback", () => {
        it("should allow owner to reply to feedback", async () => {
            const req = {
                params: { id: "f1" },
                body: { reply_content: "Cảm ơn bạn!", clubId: "c1" },
                user: { club_id: "c1" }
            };
            const res = createRes();

            const mockFeedback = {
                _id: "f1",
                club_id: "c1",
                save: jest.fn().mockResolvedValue(true)
            };
            Feedback.findById.mockResolvedValue(mockFeedback);

            await feedbackController.replyFeedback(req, res);

            expect(mockFeedback.reply_content).toBe("Cảm ơn bạn!");
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("should return 403 if feedback belongs to another club", async () => {
            const req = {
                params: { id: "f1" },
                body: { reply_content: "Reply", clubId: "c1" }
            };
            const res = createRes();
            Feedback.findById.mockResolvedValue({ _id: "f1", club_id: "c2" });
            await feedbackController.replyFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe("updateFeedback", () => {
        it("should allow user to edit feedback within 3 days", async () => {
            const req = {
                params: { id: "f1" },
                body: { rating: 4, comment: "Sửa lại" },
                user: { accountId: "u1" }
            };
            const res = createRes();

            const mockFeedback = {
                _id: "f1",
                account_id: "u1",
                created_at: new Date(), // Just now
                is_edited: false,
                save: jest.fn().mockResolvedValue(true)
            };
            Feedback.findById.mockResolvedValue(mockFeedback);

            await feedbackController.updateFeedback(req, res);

            expect(mockFeedback.is_edited).toBe(true);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("should return 400 if already edited", async () => {
            const req = { params: { id: "f1" }, body: { rating: 4 }, user: { accountId: "u1" } };
            const res = createRes();
            Feedback.findById.mockResolvedValue({ _id: "f1", account_id: "u1", is_edited: true });
            await feedbackController.updateFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("1 lần duy nhất");
        });

        it("should return 400 if more than 3 days passed", async () => {
            const req = { params: { id: "f1" }, body: { rating: 4 }, user: { accountId: "u1" } };
            const res = createRes();
            
            const fourDaysAgo = new Date();
            fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
            
            Feedback.findById.mockResolvedValue({ 
                _id: "f1", 
                account_id: "u1", 
                created_at: fourDaysAgo,
                is_edited: false 
            });
            
            await feedbackController.updateFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("quá thời hạn 3 ngày");
        });
    });
});
