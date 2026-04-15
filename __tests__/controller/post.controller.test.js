/**
 * Post Controller Unit Test Suite - Branch Coverage Edition
 * Target Branch Coverage: >70%
 * Methods: getApprovedPosts, createPost, getMyPosts, updatePost, deletePost, getPendingPosts, reviewPost
 */

const postController = require("../../controller/post.controller");
const Post = require("../../models/post.model");
const Club = require("../../models/club.model");

jest.mock("../../models/post.model");
jest.mock("../../models/club.model");

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makePopulateChain = (val) => ({
    populate: jest.fn().mockResolvedValue(val),
});

const makeSelectChain = (val) => ({
    select: jest.fn().mockResolvedValue(val),
});

const CLUB_ID = "club_001";
const OWNER_ID = "owner_001";
const POST_ID = "post_001";

describe("Post Controller - Branch Coverage Suite", () => {
    beforeAll(() => {
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ══════════════════════════════════════════════════════════════
    // getApprovedPosts
    // ══════════════════════════════════════════════════════════════
    describe("getApprovedPosts", () => {
        it("SUCCESS - returns approved posts", async () => {
            const res = makeRes();
            Post.find.mockReturnValue(makePopulateChain([{ _id: POST_ID, status: "Approved" }]));
            await postController.getApprovedPosts({}, res);
            expect(Post.find).toHaveBeenCalledWith({ status: "Approved" });
            expect(res.json).toHaveBeenCalled();
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Post.find.mockImplementation(() => { throw new Error("DB error"); });
            await postController.getApprovedPosts({}, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // createPost
    // ══════════════════════════════════════════════════════════════
    describe("createPost", () => {
        const validReq = {
            user: { accountId: OWNER_ID, club_id: CLUB_ID },
            body: { title: "New Event", content: "Details" }
        };

        it("SUCCESS - creates post with Pending status", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.mockImplementation((data) => ({
                ...data, status: "Pending", save: jest.fn().mockResolvedValue(true)
            }));
            await postController.createPost(validReq, res);
            expect(res.json).toHaveBeenCalled();
        });

        it("FAIL 401 - missing accountId (unauthenticated)", async () => {
            const res = makeRes();
            await postController.createPost({ user: {}, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it("FAIL 400 - missing club_id (no club in user or body)", async () => {
            const res = makeRes();
            // accountId present but no club_id anywhere
            await postController.createPost({ user: { accountId: OWNER_ID }, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 403 - club not owned by user", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain(null)); // not owner
            await postController.createPost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Club.findOne.mockImplementation(() => { throw new Error("DB"); });
            await postController.createPost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it("SUCCESS - uses club_id from body when not in user", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.mockImplementation((data) => ({
                ...data, save: jest.fn().mockResolvedValue(true)
            }));
            // No user.club_id → pulled from body
            await postController.createPost({
                user: { accountId: OWNER_ID },
                body: { club_id: CLUB_ID, title: "Post" }
            }, res);
            expect(res.json).toHaveBeenCalled();
        });
    });

    // ══════════════════════════════════════════════════════════════
    // getMyPosts
    // ══════════════════════════════════════════════════════════════
    describe("getMyPosts", () => {
        it("SUCCESS - returns posts for owned club", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.find.mockResolvedValue([{ _id: POST_ID }]);
            await postController.getMyPosts({ user: { accountId: OWNER_ID, club_id: CLUB_ID } }, res);
            expect(res.json).toHaveBeenCalled();
        });

        it("FAIL 401 - unauthenticated", async () => {
            const res = makeRes();
            await postController.getMyPosts({ user: {} }, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await postController.getMyPosts({ user: { accountId: OWNER_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 403 - not owner of club", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain(null));
            await postController.getMyPosts({ user: { accountId: OWNER_ID, club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Club.findOne.mockImplementation(() => { throw new Error("DB"); });
            await postController.getMyPosts({ user: { accountId: OWNER_ID, club_id: CLUB_ID } }, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // updatePost
    // ══════════════════════════════════════════════════════════════
    describe("updatePost", () => {
        const validReq = {
            params: { id: POST_ID },
            user: { accountId: OWNER_ID, club_id: CLUB_ID },
            body: { title: "Updated" }
        };

        it("SUCCESS - updates post and sets status to Pending", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.findOneAndUpdate.mockResolvedValue({ _id: POST_ID, status: "Pending" });
            await postController.updatePost(validReq, res);
            expect(Post.findOneAndUpdate).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({ status: "Pending" }),
                expect.any(Object)
            );
            expect(res.json).toHaveBeenCalled();
        });

        it("FAIL 401 - unauthenticated", async () => {
            const res = makeRes();
            await postController.updatePost({ user: {}, params: {}, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await postController.updatePost({ user: { accountId: OWNER_ID }, params: {}, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 403 - not owner of club", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain(null));
            await postController.updatePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it("FAIL 404 - post not found", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.findOneAndUpdate.mockResolvedValue(null);
            await postController.updatePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Club.findOne.mockImplementation(() => { throw new Error("DB"); });
            await postController.updatePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // deletePost
    // ══════════════════════════════════════════════════════════════
    describe("deletePost", () => {
        const validReq = {
            params: { id: POST_ID },
            user: { accountId: OWNER_ID, club_id: CLUB_ID },
            body: {}
        };

        it("SUCCESS - deletes post", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.findOneAndDelete.mockResolvedValue({ _id: POST_ID });
            await postController.deletePost(validReq, res);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Deleted successfully" }));
        });

        it("FAIL 401 - unauthenticated", async () => {
            const res = makeRes();
            await postController.deletePost({ user: {}, params: {}, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it("FAIL 400 - missing club_id", async () => {
            const res = makeRes();
            await postController.deletePost({ user: { accountId: OWNER_ID }, params: {}, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("FAIL 403 - not owner", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain(null));
            await postController.deletePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it("FAIL 404 - post not found", async () => {
            const res = makeRes();
            Club.findOne.mockReturnValue(makeSelectChain({ _id: CLUB_ID }));
            Post.findOneAndDelete.mockResolvedValue(null);
            await postController.deletePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Club.findOne.mockImplementation(() => { throw new Error("DB"); });
            await postController.deletePost(validReq, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // getPendingPosts
    // ══════════════════════════════════════════════════════════════
    describe("getPendingPosts", () => {
        it("SUCCESS - returns pending posts for staff review", async () => {
            const res = makeRes();
            Post.find.mockReturnValue(makePopulateChain([{ _id: POST_ID, status: "Pending" }]));
            await postController.getPendingPosts({}, res);
            expect(Post.find).toHaveBeenCalledWith({ status: "Pending" });
            expect(res.json).toHaveBeenCalled();
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Post.find.mockImplementation(() => { throw new Error("DB"); });
            await postController.getPendingPosts({}, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // ══════════════════════════════════════════════════════════════
    // reviewPost
    // ══════════════════════════════════════════════════════════════
    describe("reviewPost", () => {
        it("SUCCESS - approve sets status Approved and published_at", async () => {
            const res = makeRes();
            Post.findByIdAndUpdate.mockResolvedValue({ _id: POST_ID, status: "Approved" });
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "approve" }
            }, res);
            expect(Post.findByIdAndUpdate).toHaveBeenCalledWith(
                POST_ID,
                expect.objectContaining({ status: "Approved", published_at: expect.any(Date), rejected_reason: null }),
                { new: true }
            );
            expect(res.json).toHaveBeenCalled();
        });

        it("SUCCESS - reject sets Rejected status with reason", async () => {
            const res = makeRes();
            Post.findByIdAndUpdate.mockResolvedValue({ _id: POST_ID, status: "Rejected" });
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "reject", reason: "Inappropriate" }
            }, res);
            expect(Post.findByIdAndUpdate).toHaveBeenCalledWith(
                POST_ID,
                expect.objectContaining({ status: "Rejected", rejected_reason: "Inappropriate" }),
                { new: true }
            );
        });

        it("SUCCESS - reject with no reason uses default text", async () => {
            const res = makeRes();
            Post.findByIdAndUpdate.mockResolvedValue({ _id: POST_ID, status: "Rejected" });
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "reject" } // no reason
            }, res);
            expect(Post.findByIdAndUpdate).toHaveBeenCalledWith(
                POST_ID,
                expect.objectContaining({ rejected_reason: "No reason provided" }),
                { new: true }
            );
        });

        it("FAIL 400 - invalid action value", async () => {
            const res = makeRes();
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "delete" } // invalid
            }, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid action" }));
        });

        it("FAIL 404 - post not found", async () => {
            const res = makeRes();
            Post.findByIdAndUpdate.mockResolvedValue(null);
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "approve" }
            }, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("FAIL 500 - DB error", async () => {
            const res = makeRes();
            Post.findByIdAndUpdate.mockRejectedValue(new Error("DB error"));
            await postController.reviewPost({
                params: { id: POST_ID },
                body: { action: "approve" }
            }, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
