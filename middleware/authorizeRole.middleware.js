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
        process.stdout.write(`[AUTH DEBUG] UserRole: "${userRole}", Allowed: ${JSON.stringify(allowedRoles)}\n`);

        if (!userRole || !allowedRoles.includes(userRole)) {
            process.stdout.write(`[AUTH ACCESS DENIED] Role "${userRole}" not in ${JSON.stringify(allowedRoles)}\n`);
            return res.status(403).json({ 
                success: false, 
                message: "Bạn không có quyền truy cập chức năng này!" 
            });
        }
    
        next();
    };
};

module.exports = authorizeRole;
