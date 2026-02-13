const Role = require("../models/role.model");

const authorize = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const role = await Role.findById(req.user.roleId);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }

      if (!allowedRoles.includes(role.name)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      req.user.roleName = role.name;
      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  };
};

module.exports = authorize;
