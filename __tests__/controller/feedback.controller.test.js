const feedbackController = require("../../controller/feedback.controller");
const Feedback = require("../../models/feedback.model");
const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Club = require("../../models/club.model");
const Account = require("../../models/account.model");
const Notification = require("../../models/notification.model");

jest.mock("../../models/feedback.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/billiard_table.model");
jest.mock("../../models/club.model");
jest.mock("../../models/account.model");
jest.mock("../../models/notification.model");

const validAccountId = "65d1a1111111111111111111";
const validAccountId2 = "65d1a1111111111111111112";
const validBookingId = "65d1b2222222222222222222";
const validTableId = "65d1c3333333333333333333";
const validClubId = "65d1d4444444444444444444";
const validClubId2 = "65d1d4444444444444444445";
const validFeedbackId = "65d1e5555555555555555555";

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
                user: { accountId: validAccountId },
                body: { booking_id: validBookingId, rating: 5, comment: "Tuyệt vời" }
            };
            const res = createRes();

            const mockBooking = {
                _id: validBookingId,
                account_id: validAccountId,
                status: "Completed",
                table_id: { _id: validTableId, club_id: validClubId },
                populate: jest.fn().mockReturnThis()
            };
            Booking.findById.mockResolvedValue(mockBooking);
            Feedback.findOne.mockResolvedValue(null);
            Feedback.create.mockResolvedValue({ _id: validFeedbackId, ...req.body, club_id: validClubId });
            Club.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: "Club" }) }) });
            Account.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });

            await feedbackController.createFeedback(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should return 400 for invalid rating", async () => {
            const req = { 
                user: { accountId: validAccountId }, 
                body: { booking_id: validBookingId, rating: 6 } 
            };
            const res = createRes();
            await feedbackController.createFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("should return 403 if booking does not belong to user", async () => {
            const req = { 
                user: { accountId: validAccountId }, 
                body: { booking_id: validBookingId, rating: 5 } 
            };
            const res = createRes();
            Booking.findById.mockResolvedValue({ _id: validBookingId, account_id: validAccountId2 });
            await feedbackController.createFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe("getClubFeedbacks", () => {
        it("should return club feedbacks with pagination", async () => {
            const req = {
                params: { clubId: validClubId },
                query: { page: "1", rating: "5" },
                user: { club_id: validClubId }
            };
            const res = createRes();

            Feedback.find.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockReturnValue({
                        sort: jest.fn().mockReturnValue({
                            skip: jest.fn().mockReturnValue({
                                limit: jest.fn().mockReturnValue({
                                    lean: jest.fn().mockResolvedValue([{ _id: validFeedbackId, rating: 5 }])
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
                params: { id: validFeedbackId },
                body: { reply_content: "Cảm ơn bạn!", clubId: validClubId },
                user: { club_id: validClubId }
            };
            const res = createRes();

            const mockFeedback = {
                _id: validFeedbackId,
                club_id: validClubId,
                save: jest.fn().mockResolvedValue(true)
            };
            Feedback.findById.mockResolvedValue(mockFeedback);
            Club.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: "Club" }) }) });
            Booking.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ play_date: new Date(), start_time: "10:00" }) }) });
            Account.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });

            await feedbackController.replyFeedback(req, res);

            expect(mockFeedback.reply_content).toBe("Cảm ơn bạn!");
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("should return 403 if feedback belongs to another club", async () => {
            const req = {
                params: { id: validFeedbackId },
                body: { reply_content: "Reply", clubId: validClubId }
            };
            const res = createRes();
            Feedback.findById.mockResolvedValue({ _id: validFeedbackId, club_id: validClubId2 });
            await feedbackController.replyFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe("updateFeedback", () => {
        it("should allow user to edit feedback within 3 days", async () => {
            const req = {
                params: { id: validFeedbackId },
                body: { rating: 4, comment: "Sửa lại" },
                user: { accountId: validAccountId }
            };
            const res = createRes();

            const mockFeedback = {
                _id: validFeedbackId,
                account_id: validAccountId,
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
            const req = { params: { id: validFeedbackId }, body: { rating: 4 }, user: { accountId: validAccountId } };
            const res = createRes();
            Feedback.findById.mockResolvedValue({ _id: validFeedbackId, account_id: validAccountId, is_edited: true });
            await feedbackController.updateFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("1 lần duy nhất");
        });

        it("should return 400 if more than 3 days passed", async () => {
            const req = { params: { id: validFeedbackId }, body: { rating: 4 }, user: { accountId: validAccountId } };
            const res = createRes();
            
            const fourDaysAgo = new Date();
            fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
            
            Feedback.findById.mockResolvedValue({ 
                _id: validFeedbackId, 
                account_id: validAccountId, 
                created_at: fourDaysAgo,
                is_edited: false 
            });
            
            await feedbackController.updateFeedback(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("quá thời hạn 3 ngày");
        });
    });
});
