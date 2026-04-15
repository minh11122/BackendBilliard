/**
 * Subscription Controller Unit Test Suite - Branch Coverage Edition
 * Target Branch Coverage: >70%
 * Methods: getSubscriptions, getCurrentSubscription, createSubscriptionPayment, verifySubscriptionPayment
 */

jest.mock("@payos/node");
jest.mock("../../services/payment.service");
jest.mock("../../models/subscription.model");
jest.mock("../../models/subcription_account.model");

const subscriptionController = require("../../controller/subscription.controller");
const Subscription = require("../../models/subscription.model");
const SubscriptionAccount = require("../../models/subcription_account.model");
const paymentService = require("../../services/payment.service");

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

describe("Subscription Controller - Branch Coverage Suite", () => {
    beforeAll(() => {
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ══════════════════════════════════════════════════════════════
    // getSubscriptions
    // ══════════════════════════════════════════════════════════════
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

    // ══════════════════════════════════════════════════════════════
    // getCurrentSubscription
    // ══════════════════════════════════════════════════════════════
    describe("getCurrentSubscription", () => {
        it("SUCCESS - returns active subscription for club", async () => {
            const res = makeRes();
            SubscriptionAccount.findOne.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockResolvedValue({ _id: "sa1", status: "Active" })
                })
            });
            await subscriptionController.getCurrentSubscription({ query: { club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("SUCCESS - returns null when no active subscription", async () => {
            const res = makeRes();
            SubscriptionAccount.findOne.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockResolvedValue(null)
                })
            });
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

    // ══════════════════════════════════════════════════════════════
    // createSubscriptionPayment
    // ══════════════════════════════════════════════════════════════
    describe("createSubscriptionPayment", () => {
        const validReq = {
            user: { accountId: ACCOUNT_ID },
            body: { subscription_id: SUB_ID, club_id: CLUB_ID, returnUrl: "ret", cancelUrl: "can" }
        };

        it("SUCCESS - creates payment with discount applied", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000, discount_percent: 10 });
            paymentService.createPayment.mockResolvedValue({ checkoutUrl: "http://pay.url" });
            await subscriptionController.createSubscriptionPayment(validReq, res);
            // 100000 - 10% = 90000
            expect(paymentService.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 90000 }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("SUCCESS - creates payment with no discount (discount_percent=0)", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 200000, discount_percent: 0 });
            paymentService.createPayment.mockResolvedValue({ checkoutUrl: "http://pay.url" });
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(paymentService.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 200000 }));
        });

        it("SUCCESS - creates payment with no discount_percent field (undefined → 0)", async () => {
            const res = makeRes();
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 50000 }); // no discount_percent
            paymentService.createPayment.mockResolvedValue({ checkoutUrl: "http://pay.url" });
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(paymentService.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000 }));
        });

        it("FAIL 400 - missing subscription_id", async () => {
            const res = makeRes();
            await subscriptionController.createSubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { club_id: CLUB_ID } // missing subscription_id
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await subscriptionController.createSubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { subscription_id: SUB_ID } // missing club_id
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
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000, discount_percent: 0 });
            paymentService.createPayment.mockRejectedValue(new Error("payment failed"));
            await subscriptionController.createSubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // verifySubscriptionPayment
    // ══════════════════════════════════════════════════════════════
    describe("verifySubscriptionPayment", () => {
        const validReq = {
            user: { accountId: ACCOUNT_ID },
            body: { orderCode: "ORD123", subscription_id: SUB_ID, club_id: CLUB_ID }
        };

        it("SUCCESS - creates new subscription account when none exists", async () => {
            const res = makeRes();
            paymentService.verifyPayment.mockResolvedValue({});
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 100000, discount_percent: 0 });
            SubscriptionAccount.findOne.mockResolvedValue(null); // no existing record
            SubscriptionAccount.create.mockResolvedValue({ _id: "sa1", status: "Active" });
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(SubscriptionAccount.create).toHaveBeenCalledWith(expect.objectContaining({ status: "Active" }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("SUCCESS - updates existing subscription account when one exists", async () => {
            const res = makeRes();
            paymentService.verifyPayment.mockResolvedValue({});
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 200000, discount_percent: 20 });
            const existingSub = makeMockDoc({ _id: "sa1", club_id: CLUB_ID, status: "Expired" });
            SubscriptionAccount.findOne.mockResolvedValue(existingSub);
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(existingSub.save).toHaveBeenCalled();
            expect(existingSub.status).toBe("Active");
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("SUCCESS - verifies payment with discount applied to price", async () => {
            const res = makeRes();
            paymentService.verifyPayment.mockResolvedValue({});
            Subscription.findById.mockResolvedValue({ _id: SUB_ID, price: 300000, discount_percent: 33 });
            SubscriptionAccount.findOne.mockResolvedValue(null);
            SubscriptionAccount.create.mockResolvedValue({ _id: "sa2" });
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            // price = 300000 - (300000 * 33 / 100) = 300000 - 99000 = 201000
            expect(SubscriptionAccount.create).toHaveBeenCalledWith(
                expect.objectContaining({ purchase_price: 201000 })
            );
        });

        it("FAIL 400 - missing orderCode", async () => {
            const res = makeRes();
            await subscriptionController.verifySubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { subscription_id: SUB_ID, club_id: CLUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 400 - missing subscription_id", async () => {
            const res = makeRes();
            await subscriptionController.verifySubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { orderCode: "ORD", club_id: CLUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await subscriptionController.verifySubscriptionPayment({
                user: { accountId: ACCOUNT_ID },
                body: { orderCode: "ORD", subscription_id: SUB_ID }
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 404 - subscription not found", async () => {
            const res = makeRes();
            paymentService.verifyPayment.mockResolvedValue({});
            Subscription.findById.mockResolvedValue(null);
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 400 - payment verification throws error", async () => {
            const res = makeRes();
            paymentService.verifyPayment.mockRejectedValue(new Error("Payment not confirmed"));
            await subscriptionController.verifySubscriptionPayment(validReq, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });
});
