/**
 * Subscription Controller Unit Test Suite - Branch Coverage Edition
 * Target Branch Coverage: >70%
 * Methods: getSubscriptions, getCurrentSubscription, createSubscriptionPayment, verifySubscriptionPayment
 */

jest.mock("@payos/node");
jest.mock("../../services/payos.service");
jest.mock("../../models/subscription.model");
jest.mock("../../models/subcription_account.model");
jest.mock("../../models/transiction_history.model");

const subscriptionController = require("../../controller/subscription");
const Subscription = require("../../models/subscription.model");
const SubscriptionAccount = require("../../models/subcription_account.model");
const TransactionHistory = require("../../models/transiction_history.model");
const payosService = require("../../services/payos.service");

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makeMockDoc = (data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
});

const CLUB_ID = "club_001";
const ACCOUNT_ID = "acc_001";
const SUB_ID = "sub_001";

const futureExpireDate = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d;
};

const pastExpireDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d;
};

let findOneMock;

const mockFindClubRecord = (...records) => {
    if (!findOneMock) {
        findOneMock = jest.fn();
    }
    SubscriptionAccount.findOne.mockImplementation(findOneMock);
    findOneMock.mockReset();
    records.forEach(record => {
        findOneMock.mockReturnValueOnce({
            sort: jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(record),
                then: (resolve) => resolve(record)
            })
        });
    });
    // Default to the last record if called more times
    if (records.length > 0) {
        findOneMock.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(records[records.length - 1]),
                then: (resolve) => resolve(records[records.length - 1])
            })
        });
    }
};



describe("Subscription Controller - Branch Coverage Suite", () => {
    beforeAll(() => {
        // jest.spyOn(console, "error")
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getSubscriptions", () => {
        it("SUCCESS - returns all subscription packages", async () => {
            const res = makeRes();
            Subscription.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: "Basic" }]) });
            await subscriptionController.getSubscriptions({}, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.any(Array) }));
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Subscription.find.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error("fail")) });
            await subscriptionController.getSubscriptions({}, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe("getCurrentSubscription", () => {
        it("SUCCESS - returns active subscription for club", async () => {
            const res = makeRes();
            mockFindClubRecord({
                _id: "sa1",
                status: "active",
                expire_date: futureExpireDate(),
                account_id: "acc1"
            });
            await subscriptionController.getCurrentSubscription({ query: { club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("SUCCESS - returns null when subscription expired", async () => {
            const res = makeRes();
            const expired = makeMockDoc({
                _id: "sa1",
                status: "active",
                expire_date: pastExpireDate()
            });
            mockFindClubRecord(expired);
            await subscriptionController.getCurrentSubscription({ query: { club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: null }));
            expect(expired.save).toHaveBeenCalled();
        });

        it("SUCCESS - returns null when no subscription", async () => {
            const res = makeRes();
            mockFindClubRecord(null);
            await subscriptionController.getCurrentSubscription({ query: { club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: null }));
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await subscriptionController.getCurrentSubscription({ query: {} }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            SubscriptionAccount.findOne.mockImplementation(() => { throw new Error("DB"); });
            await subscriptionController.getCurrentSubscription({ query: { club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe("createSubscriptionPayment", () => {
        const validReq = {
            user: { accountId: ACCOUNT_ID },
            body: { subscription_id: SUB_ID, club_id: CLUB_ID, returnUrl: "ret", cancelUrl: "can" }
        };

        it("SUCCESS - creates payment with price * months", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000 });
            mockFindClubRecord(null);
            TransactionHistory.create.mockResolvedValue({});
            payosService.createPaymentLink.mockResolvedValue({ checkoutUrl: "http://pay.url" });
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(TransactionHistory.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100000 }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("SUCCESS - multiplies price by duration_months", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000 });
            mockFindClubRecord(null);
            TransactionHistory.create.mockResolvedValue({});
            payosService.createPaymentLink.mockResolvedValue({ checkoutUrl: "http://pay.url" });
            await subscriptionController.createSubscriptionPayment({
                ...validReq,
                body: { ...validReq.body, duration_months: 3 }
            }, res);
            expect(TransactionHistory.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 300000 }));
        });

        it("FAIL 400 - missing subscription_id", async () => {
            const res = makeRes();
            await subscriptionController.createSubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { club_id: CLUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await subscriptionController.createSubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { subscription_id: SUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 404 - subscription not found", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue(null);
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 500 - payment service error", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000 });
            mockFindClubRecord(null);
            TransactionHistory.create.mockRejectedValue(new Error("payment failed"));
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe("verifySubscriptionPayment", () => {
        const validReq = {
            user: { accountId: ACCOUNT_ID },
            body: { orderCode: "ORD123", subscription_id: SUB_ID, club_id: CLUB_ID }
        };

        const mockMarkPaid = (tx = { account_id: ACCOUNT_ID }) => {
            TransactionHistory.findOneAndUpdate.mockResolvedValue(tx);
        };

        it("SUCCESS - creates new subscription account when none exists", async () => {
            const res = makeRes();
            payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
            mockMarkPaid();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000, post_limit: 10 });

            mockFindClubRecord(null, null);

            SubscriptionAccount.create.mockResolvedValue({ _id: "sa1", status: "active" });
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(SubscriptionAccount.create).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("SUCCESS - renews same plan and keeps posts_used", async () => {
            const res = makeRes();
            payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
            mockMarkPaid();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000, post_limit: 5 });

            const existingSub = makeMockDoc({
                _id: "sa1",
                club_id: CLUB_ID,
                subscription_id: SUB_ID,
                status: "expired",
                expire_date: pastExpireDate(),
                posts_used: 3,
                post_limit: 10,
                start_date: new Date("2026-01-01")
            });

            mockFindClubRecord(null, existingSub);

            await subscriptionController.verifySubscriptionPayment({
                ...validReq,
                body: { ...validReq.body, duration_months: 3 }
            }, res);

            expect(existingSub.save).toHaveBeenCalled();
            expect(existingSub.status).toBe("active");
            expect(existingSub.posts_used).toBe(3);
            expect(existingSub.post_limit).toBe(15);
        });

        it("SUCCESS - updates existing subscription on plan change resets posts", async () => {
            const res = makeRes();
            payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
            mockMarkPaid();
            Subscription.findById.mockResolvedValue({ _id: "sub_pro", price: 200000, post_limit: 20 });

            const existingSub = makeMockDoc({
                _id: "sa1",
                club_id: CLUB_ID,
                subscription_id: SUB_ID,
                status: "expired",
                expire_date: pastExpireDate(),
                posts_used: 7,
                post_limit: 10
            });

            mockFindClubRecord(null, existingSub);

            await subscriptionController.verifySubscriptionPayment({
                ...validReq,
                body: { ...validReq.body, subscription_id: "sub_pro" }
            }, res);

            expect(existingSub.posts_used).toBe(0);
            expect(existingSub.post_limit).toBe(20);
        });

        it("FAIL 400 - missing orderCode", async () => {
            const res = makeRes();
            await subscriptionController.verifySubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { subscription_id: SUB_ID, club_id: CLUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 404 - subscription not found", async () => {
            const res = makeRes();
            payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
            mockMarkPaid();
            Subscription.findById.mockResolvedValue(null);
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 400 - payment verification throws error", async () => {
            const res = makeRes();
            payosService.getPaymentInfo.mockRejectedValue(new Error("Payment not confirmed"));
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });
});
