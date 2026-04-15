const Account = require("../../models/account.model");
const Club = require("../../models/club.model");
const Role = require("../../models/role.model");
const bcrypt = require("bcryptjs");
const staffClubController = require("../../controller/staff_club.controller");

jest.mock("../../models/account.model");
jest.mock("../../models/club.model");
jest.mock("../../models/role.model");
jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed_password"),
}));

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockQuery = (val) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  then: jest.fn((resolve) => Promise.resolve(val).then(resolve)),
  catch: jest.fn((reject) => Promise.resolve(val).catch(reject)),
  lean: jest.fn().mockResolvedValue(val),
});

describe("Staff Club Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createStaffClub", () => {
    it("should create a staff account for a club owned by user", async () => {
      const req = {
        user: { accountId: "owner1" },
        body: {
          club_id: "c1",
          fullname: "Staff VIP",
          email: "staff@example.com",
          password: "password123"
        }
      };
      const res = createRes();

      // verifyClubOwnership mock
      Club.findOne.mockResolvedValue({ _id: "c1", account_id: "owner1" });
      
      Account.findOne.mockResolvedValue(null); // email not taken
      Role.findOne.mockResolvedValue({ _id: "role_staff_club" });
      Account.create.mockResolvedValue({ 
        _id: "s1", 
        fullname: "Staff VIP", 
        toObject: () => ({ _id: "s1", fullname: "Staff VIP" }) 
      });

      await staffClubController.createStaffClub(req, res);

      expect(Account.create).toHaveBeenCalledWith(expect.objectContaining({
        club_id: "c1",
        role_id: "role_staff_club"
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 403 if user does not own the club", async () => {
        const req = {
          user: { accountId: "owner2" },
          body: { club_id: "c1" }
        };
        const res = createRes();
  
        Club.findOne.mockResolvedValue(null); // not owned
  
        await staffClubController.createStaffClub(req, res);
  
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: "Bạn không có quyền thêm nhân viên cho quán này"
        }));
      });
  });

  describe("Staff Management CRUD", () => {
    it("should get active staff list for a club", async () => {
        const req = {
          user: { accountId: "owner1" },
          query: { club_id: "c1" }
        };
        const res = createRes();
  
        Club.findOne.mockResolvedValue({ _id: "c1" });
        Account.find.mockReturnValue(mockQuery([{ _id: "s1", fullname: "Staff 1" }]));
  
        await staffClubController.getActiveStaffClub(req, res);
  
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([{ _id: "s1", fullname: "Staff 1" }])
        }));
    });

    it("should ban a staff member", async () => {
        const req = {
          user: { accountId: "owner1" },
          params: { id: "s1" }
        };
        const res = createRes();
  
        const staffMock = { _id: "s1", club_id: "c1", status: "ACTIVE", save: jest.fn() };
        Account.findById.mockResolvedValue(staffMock);
        Club.findOne.mockResolvedValue({ _id: "c1" });
  
        await staffClubController.banStaffClub(req, res);
  
        expect(staffMock.status).toBe("BANNED");
        expect(staffMock.save).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã cấm (Ban) nhân viên quán thành công" }));
    });
    it("should unban a staff member", async () => {
        const req = { user: { accountId: "owner1" }, params: { id: "s1" } };
        const res = createRes();
        const staffMock = { _id: "s1", club_id: "c1", status: "BANNED", save: jest.fn() };
        Account.findById.mockResolvedValue(staffMock);
        Club.findOne.mockResolvedValue({ _id: "c1" });
        await staffClubController.unbanStaffClub(req, res);
        expect(staffMock.status).toBe("ACTIVE");
        expect(staffMock.save).toHaveBeenCalled();
    });

    it("should delete a staff member (status DELETED)", async () => {
        const req = { user: { accountId: "owner1" }, params: { id: "s1" } };
        const res = createRes();
        const staffMock = { _id: "s1", club_id: "c1", status: "ACTIVE", save: jest.fn() };
        Account.findById.mockResolvedValue(staffMock);
        Club.findOne.mockResolvedValue({ _id: "c1" });
        await staffClubController.deleteStaffClub(req, res);
        expect(staffMock.status).toBe("DELETED");
    });

    it("should get staff detail by ID", async () => {
        const req = { user: { accountId: "owner1" }, params: { id: "s1" } };
        const res = createRes();
        const staffMock = { _id: "s1", club_id: "c1", fullname: "Staff A" };
        Account.findById.mockReturnValue(mockQuery(staffMock));
        Club.findOne.mockResolvedValue({ _id: "c1" });
        await staffClubController.getStaffClubById(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: staffMock }));
    });

    it("should update staff profile successfully", async () => {
        const req = { 
            user: { accountId: "owner1" }, 
            params: { id: "s1" },
            body: { fullname: "New Name", password: "newpassword" }
        };
        const res = createRes();
        const staffMock = { 
            _id: "s1", 
            club_id: "c1", 
            fullname: "Old Name", 
            save: jest.fn(),
            toObject: () => ({ _id: "s1", fullname: "New Name" })
        };
        Account.findById.mockResolvedValue(staffMock);
        Club.findOne.mockResolvedValue({ _id: "c1" });
        await staffClubController.updateStaffClub(req, res);
        expect(staffMock.fullname).toBe("New Name");
        expect(staffMock.save).toHaveBeenCalled();
    });
  });
});
