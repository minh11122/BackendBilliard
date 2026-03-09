const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        // req.user được set bởi authenticate middleware (chứa decoded JWT)
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: "Chưa xác thực. Vui lòng đăng nhập!" 
            });
        }

        const userRole = req.user.role; // role được lưu trong JWT payload

        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                success: false, 
                message: "Bạn không có quyền truy cập chức năng này!" 
            });
        }

        next();
    };
};

module.exports = authorizeRole;
