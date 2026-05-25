/**
 * Admin Controller Unit Test Suite - Legendary Masterpiece Edition
 * Target Coverage: >75% | Quality: Senior QA Gold Standard
 * Methods: getAllAccountsForAdmin, getAllClubs, getAllSubscriptions,
 *          toggleBanAccount, deleteAccount, createSubscription,
 *          getSubscriptionById, updateSubscription, deleteSubscription,
 *          getRevenueWeb, getRevenueWebSummary, createAccount
 */

const adminController = require("../../controller/admin/admin.controller");
const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Club = require("../../models/club.model");
const Subscription = require("../../models/subscription.model");
const SubscriptionAccount = require("../../models/subcription_account.model");
const bcrypt = require("bcryptjs");

jest.mock("../../models/account.model");
jest.mock("../../models/role.model");
jest.mock("../../models/club.model");
jest.mock("../../models/subscription.model");
jest.mock("../../models/subcription_account.model");
jest.mock("bcryptjs");

// ─── Query Chain Builder ───────────────────────────────────────────────────────
const makeChain = (data) => {
    const chain = {};
    ["populate", "select", "sort", "skip", "limit"].forEach((m) => {
        chain[m] = jest.fn().mockReturnValue(chain);
    });
    chain.then = (res, rej) => Promise.resolve(data).then(res, rej);
    chain.lean = jest.fn().mockResolvedValue(data);
    // Allow direct await on chain (thenable)
    Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
    return chain;
};

const makeMockDoc = (data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
});

// ─── Shared IDs ────────────────────────────────────────────────────────────────
const ADMIN_ROLE_ID = "role_admin_001";
const STAFF_ROLE_ID = "role_staff_001";
const ACCOUNT_ID = "acc_001";
const CLUB_ID = "club_001";
const SUB_ID = "sub_001";

// ─── Helpers ───────────────────────────────────────────────────────────────────
const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

// ─── Test Suite ────────────────────────────────────────────────────────────────
describe("Admin Controller - Legendary Masterpiece Suite", () => {
    beforeAll(() => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "log").mockImplementation(() => {});
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getAllAccountsForAdmin
    // ══════════════════════════════════════════════════════════════════════════
    describe("getAllAccountsForAdmin", () => {
        it("SUCCESS - returns paginated accounts excluding ADMIN role", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: ADMIN_ROLE_ID });
            Account.find.mockReturnValue(makeChain([{ _id: ACCOUNT_ID, email: "user@test.com" }]));
            Account.countDocuments.mockResolvedValue(1);

            await adminController.getAllAccountsForAdmin({ query: { page: 1, limit: 10 } }, res);

            expect(Account.find).toHaveBeenCalledWith(expect.objectContaining({
                role_id: { $ne: ADMIN_ROLE_ID }
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Lấy danh sách account thành công",
                pagination: expect.objectContaining({ total: 1 })
            }));
        });

        it("SUCCESS - search by email/fullname query filter", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: ADMIN_ROLE_ID });
            Account.find.mockReturnValue(makeChain([]));
            Account.countDocuments.mockResolvedValue(0);

            await adminController.getAllAccountsForAdmin({
                query: { page: 1, limit: 10, search: "staff" }
            }, res);

            expect(Account.find).toHaveBeenCalledWith(expect.objectContaining({
                $or: expect.any(Array)
            }));
        });

        it("SUCCESS - filter by role (non-ALL)", async () => {
            const res = makeRes();
            Role.findOne
                .mockResolvedValueOnce({ _id: ADMIN_ROLE_ID }) // admin check
                .mockResolvedValueOnce({ _id: STAFF_ROLE_ID, name: "OWNER" }); // role filter
            Account.find.mockReturnValue(makeChain([]));
            Account.countDocuments.mockResolvedValue(0);

            await adminController.getAllAccountsForAdmin({
                query: { page: 1, limit: 10, role: "OWNER" }
            }, res);

            expect(Role.findOne).toHaveBeenCalledTimes(2);
        });

        it("SUCCESS - filter by status (non-ALL)", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: ADMIN_ROLE_ID });
            Account.find.mockReturnValue(makeChain([]));
            Account.countDocuments.mockResolvedValue(0);

            await adminController.getAllAccountsForAdmin({
                query: { page: 1, limit: 5, status: "BANNED" }
            }, res);

            expect(Account.find).toHaveBeenCalledWith(expect.objectContaining({
                status: "BANNED"
            }));
        });

        it("FAIL 500 - DB error propagates to 500", async () => {
            const res = makeRes();
            Role.findOne.mockRejectedValue(new Error("DB down"));

            await adminController.getAllAccountsForAdmin({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getAllClubs
    // ══════════════════════════════════════════════════════════════════════════
    describe("getAllClubs", () => {
        it("SUCCESS - returns paginated clubs", async () => {
            const res = makeRes();
            Club.find.mockReturnValue(makeChain([{ _id: CLUB_ID, name: "Club A" }]));
            Club.countDocuments.mockResolvedValue(1);

            await adminController.getAllClubs({ query: { page: 1, limit: 10 } }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Lấy danh sách club thành công",
                pagination: expect.objectContaining({ total: 1 })
            }));
        });

        it("SUCCESS - search by name/address applies $or", async () => {
            const res = makeRes();
            Club.find.mockReturnValue(makeChain([]));
            Club.countDocuments.mockResolvedValue(0);

            await adminController.getAllClubs({
                query: { page: 1, limit: 10, search: "billiard" }
            }, res);

            expect(Club.find).toHaveBeenCalledWith(expect.objectContaining({
                $or: expect.any(Array)
            }));
        });

        it("SUCCESS - filter by status", async () => {
            const res = makeRes();
            Club.find.mockReturnValue(makeChain([]));
            Club.countDocuments.mockResolvedValue(0);

            await adminController.getAllClubs({
                query: { status: "APPROVED" }
            }, res);

            expect(Club.find).toHaveBeenCalledWith(expect.objectContaining({
                status: "APPROVED"
            }));
        });

        it("FAIL 500 - DB error propagates", async () => {
            const res = makeRes();
            Club.find.mockImplementation(() => { throw new Error("DB fail"); });

            await adminController.getAllClubs({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getAllSubscriptions
    // ══════════════════════════════════════════════════════════════════════════
    describe("getAllSubscriptions", () => {
        it("SUCCESS - returns paginated subscriptions", async () => {
            const res = makeRes();
            Subscription.countDocuments.mockResolvedValue(3);
            Subscription.find.mockReturnValue(makeChain([{ _id: SUB_ID, name: "Basic" }]));

            await adminController.getAllSubscriptions({
                query: { page: 1, limit: 10 }
            }, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Lấy danh sách gói thành công",
                pagination: expect.objectContaining({ total: 3 })
            }));
        });

        it("SUCCESS - search filter applies name regex", async () => {
            const res = makeRes();
            Subscription.countDocuments.mockResolvedValue(1);
            Subscription.find.mockReturnValue(makeChain([]));

            await adminController.getAllSubscriptions({
                query: { search: "pro" }
            }, res);

            expect(Subscription.find).toHaveBeenCalledWith(
                expect.objectContaining({ name: { $regex: "pro", $options: "i" } })
            );
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Subscription.countDocuments.mockRejectedValue(new Error("fail"));

            await adminController.getAllSubscriptions({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // toggleBanAccount
    // ══════════════════════════════════════════════════════════════════════════
    describe("toggleBanAccount", () => {
        it("SUCCESS - ACTIVE account becomes BANNED", async () => {
            const res = makeRes();
            const mockAcc = makeMockDoc({ _id: ACCOUNT_ID, status: "ACTIVE" });
            Account.findById.mockResolvedValue(mockAcc);

            await adminController.toggleBanAccount({ params: { id: ACCOUNT_ID } }, res);

            expect(mockAcc.status).toBe("BANNED");
            expect(mockAcc.save).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã ban account" }));
        });

        it("SUCCESS - BANNED account becomes ACTIVE (unban)", async () => {
            const res = makeRes();
            const mockAcc = makeMockDoc({ _id: ACCOUNT_ID, status: "BANNED" });
            Account.findById.mockResolvedValue(mockAcc);

            await adminController.toggleBanAccount({ params: { id: ACCOUNT_ID } }, res);

            expect(mockAcc.status).toBe("ACTIVE");
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã bỏ ban account" }));
        });

        it("FAIL 404 - account not found", async () => {
            const res = makeRes();
            Account.findById.mockResolvedValue(null);

            await adminController.toggleBanAccount({ params: { id: "nonexistent" } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Không tìm thấy account" }));
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Account.findById.mockRejectedValue(new Error("DB error"));

            await adminController.toggleBanAccount({ params: { id: ACCOUNT_ID } }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // deleteAccount
    // ══════════════════════════════════════════════════════════════════════════
    describe("deleteAccount", () => {
        it("SUCCESS - deletes account permanently", async () => {
            const res = makeRes();
            Account.findByIdAndDelete.mockResolvedValue({ _id: ACCOUNT_ID });

            await adminController.deleteAccount({ params: { id: ACCOUNT_ID } }, res);

            expect(Account.findByIdAndDelete).toHaveBeenCalledWith(ACCOUNT_ID);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã xóa vĩnh viễn account" }));
        });

        it("FAIL 404 - account not found", async () => {
            const res = makeRes();
            Account.findByIdAndDelete.mockResolvedValue(null);

            await adminController.deleteAccount({ params: { id: "bad_id" } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Không tìm thấy account" }));
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Account.findByIdAndDelete.mockRejectedValue(new Error("DB error"));

            await adminController.deleteAccount({ params: { id: ACCOUNT_ID } }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // createSubscription
    // ══════════════════════════════════════════════════════════════════════════
    describe("createSubscription", () => {
        it("SUCCESS - creates new subscription and returns 201", async () => {
            const res = makeRes();
            Subscription.prototype.save = jest.fn().mockResolvedValue(true);

            await adminController.createSubscription({
                body: { name: "Pro", price: 500000, description: "Full features", post_limit: 50 },
                user: { _id: "admin1" }
            }, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tạo gói thành công" }));
        });

        it("FAIL 500 - DB save error", async () => {
            const res = makeRes();
            Subscription.prototype.save = jest.fn().mockRejectedValue(new Error("save fail"));

            await adminController.createSubscription({ body: { name: "X", price: 100 } }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getSubscriptionById
    // ══════════════════════════════════════════════════════════════════════════
    describe("getSubscriptionById", () => {
        it("SUCCESS - returns subscription details", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, name: "Basic", price: 100000 });

            await adminController.getSubscriptionById({ params: { id: SUB_ID } }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Lấy chi tiết gói thành công",
                data: expect.objectContaining({ name: "Basic" })
            }));
        });

        it("FAIL 404 - subscription not found", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue(null);

            await adminController.getSubscriptionById({ params: { id: "nonexistent" } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Không tìm thấy gói" }));
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Subscription.findById.mockRejectedValue(new Error("fail"));

            await adminController.getSubscriptionById({ params: { id: SUB_ID } }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // updateSubscription
    // ══════════════════════════════════════════════════════════════════════════
    describe("updateSubscription", () => {
        it("SUCCESS - updates and returns updated subscription", async () => {
            const res = makeRes();
            const updated = { _id: SUB_ID, name: "Pro Updated", price: 600000 };
            Subscription.findByIdAndUpdate.mockResolvedValue(updated);

            await adminController.updateSubscription({
                params: { id: SUB_ID },
                body: { name: "Pro Updated", price: 600000 }
            }, res);

            expect(Subscription.findByIdAndUpdate).toHaveBeenCalledWith(
                SUB_ID,
                expect.objectContaining({ name: "Pro Updated" }),
                { new: true }
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Cập nhật gói thành công",
                data: updated
            }));
        });

        it("FAIL 404 - subscription not found", async () => {
            const res = makeRes();
            Subscription.findByIdAndUpdate.mockResolvedValue(null);

            await adminController.updateSubscription({
                params: { id: "bad_id" },
                body: { name: "X" }
            }, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Subscription.findByIdAndUpdate.mockRejectedValue(new Error("fail"));

            await adminController.updateSubscription({ params: { id: SUB_ID }, body: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // deleteSubscription
    // ══════════════════════════════════════════════════════════════════════════
    describe("deleteSubscription", () => {
        it("SUCCESS - deletes subscription", async () => {
            const res = makeRes();
            Subscription.findByIdAndDelete.mockResolvedValue({ _id: SUB_ID });

            await adminController.deleteSubscription({ params: { id: SUB_ID } }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Xóa gói thành công" }));
        });

        it("FAIL 404 - not found", async () => {
            const res = makeRes();
            Subscription.findByIdAndDelete.mockResolvedValue(null);

            await adminController.deleteSubscription({ params: { id: "bad" } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Không tìm thấy gói" }));
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Subscription.findByIdAndDelete.mockRejectedValue(new Error("fail"));

            await adminController.deleteSubscription({ params: { id: SUB_ID } }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getRevenueWeb
    // ══════════════════════════════════════════════════════════════════════════
    describe("getRevenueWeb", () => {
        it("SUCCESS - returns paginated revenue data (no date filter)", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([{ _id: "sa1", club_name: "Club A", purchase_price: 100000 }]);
            SubscriptionAccount.countDocuments.mockResolvedValue(1);

            await adminController.getRevenueWeb({ query: { page: 1, limit: 10 } }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Danh sách doanh thu web",
                pagination: expect.objectContaining({ total: 1 })
            }));
        });

        it("SUCCESS - with date range filter (from/to string format)", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([]);
            SubscriptionAccount.countDocuments.mockResolvedValue(0);

            await adminController.getRevenueWeb({
                query: { page: 1, limit: 10, from: "2026-01-01", to: "2026-01-31" }
            }, res);

            // Aggregate is called with time filter in match stage
            expect(SubscriptionAccount.aggregate).toHaveBeenCalled();
        });

        it("SUCCESS - with date range filter (ISO T format)", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([]);
            SubscriptionAccount.countDocuments.mockResolvedValue(0);

            await adminController.getRevenueWeb({
                query: { from: "2026-01-01T00:00:00Z", to: "2026-01-31T23:59:59Z" }
            }, res);

            expect(SubscriptionAccount.aggregate).toHaveBeenCalled();
        });

        it("SUCCESS - with search term filters by club/subscription name", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([]);
            SubscriptionAccount.countDocuments.mockResolvedValue(0);

            await adminController.getRevenueWeb({ query: { search: "Pro" } }, res);

            expect(SubscriptionAccount.aggregate).toHaveBeenCalled();
        });

        it("FAIL 500 - DB aggregate error", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockRejectedValue(new Error("DB error"));

            await adminController.getRevenueWeb({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getRevenueWebSummary
    // ══════════════════════════════════════════════════════════════════════════
    describe("getRevenueWebSummary", () => {
        it("SUCCESS - returns total revenue and orders", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([{ total_revenue: 500000, total_orders: 5 }]);

            await adminController.getRevenueWebSummary({
                query: { from: "2026-01-01", to: "2026-01-31" }
            }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Tổng doanh thu web",
                data: { total_revenue: 500000, total_orders: 5 }
            }));
        });

        it("SUCCESS - returns zeros when no records match", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([]); // empty result

            await adminController.getRevenueWebSummary({ query: {} }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { total_revenue: 0, total_orders: 0 }
            }));
        });

        it("SUCCESS - uses ISO T format for from/to", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockResolvedValue([{ total_revenue: 100, total_orders: 1 }]);

            await adminController.getRevenueWebSummary({
                query: { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" }
            }, res);

            expect(SubscriptionAccount.aggregate).toHaveBeenCalled();
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            SubscriptionAccount.aggregate.mockRejectedValue(new Error("fail"));

            await adminController.getRevenueWebSummary({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // createAccount (STAFF_SYSTEM)
    // ══════════════════════════════════════════════════════════════════════════
    describe("createAccount", () => {
        const validReq = {
            body: {
                email: "staff@test.com",
                password: "Password1!",
                fullname: "Staff Name",
                phone: "0912345678"
            }
        };

        it("SUCCESS - creates staff account with hashed password", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });
            Account.findOne.mockResolvedValue(null); // email not taken
            bcrypt.hash.mockResolvedValue("hashed_password");
            Account.prototype.save = jest.fn().mockResolvedValue(true);

            await adminController.createAccount(validReq, res);

            expect(bcrypt.hash).toHaveBeenCalledWith("Password1!", 10);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Tạo nhân viên hệ thống thành công"
            }));
        });

        it("FAIL 400 - role STAFF_SYSTEM not found", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue(null); // role missing

            await adminController.createAccount(validReq, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Role không tồn tại" }));
        });

        it("FAIL 400 - weak password (no uppercase, no special char)", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });

            await adminController.createAccount({
                body: { ...validReq.body, password: "weakpassword" }
            }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("Mật khẩu")
            }));
        });

        it("FAIL 400 - invalid phone format", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });

            await adminController.createAccount({
                body: { ...validReq.body, phone: "invalid_phone" }
            }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: "Số điện thoại không hợp lệ"
            }));
        });

        it("FAIL 400 - duplicate email (found by Account.findOne)", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });
            Account.findOne.mockResolvedValue({ _id: ACCOUNT_ID, email: "staff@test.com" }); // already exists

            await adminController.createAccount(validReq, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Email đã tồn tại" }));
        });

        it("FAIL 400 - duplicate email via DB unique index (error code 11000)", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });
            Account.findOne.mockResolvedValue(null);
            bcrypt.hash.mockResolvedValue("hashed");
            const dupError = new Error("duplicate");
            dupError.code = 11000;
            Account.prototype.save = jest.fn().mockRejectedValue(dupError);

            await adminController.createAccount(validReq, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Email đã tồn tại" }));
        });

        it("FAIL 500 - unexpected server error", async () => {
            const res = makeRes();
            Role.findOne.mockResolvedValue({ _id: STAFF_ROLE_ID });
            Account.findOne.mockResolvedValue(null);
            bcrypt.hash.mockRejectedValue(new Error("bcrypt exploded"));

            await adminController.createAccount(validReq, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
