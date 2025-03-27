const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'attendance_system'
});

db.connect(err => {
    if (err) console.error("Database Connection Failed: ", err);
    else console.log('✅ Database connected!');
});

app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: "All fields are required!" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [username, hashedPassword, role],
        (err) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ message: "User registered successfully!" });
        });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "All fields are required!" });
    }
    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, result) => {
        if (err || result.length === 0) {
            return res.status(400).json({ error: "Invalid credentials" });
        }
        const user = result[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({ error: "Invalid credentials" });
        }
        req.session.user = { id: user.id, role: user.role };
        res.json({ message: "Login successful!", role: user.role });
    });
});


app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: "Logged out successfully" });
});


app.post("/create-class", (req, res) => {
    const { class_id, teacher_id, class_name, latitude, longitude } = req.body;
    if (!class_id || !teacher_id || !class_name || !latitude || !longitude) {
        return res.status(400).json({ error: "All fields are required!" });
    }
    db.query("SELECT * FROM teachers WHERE teacher_id = ?", [teacher_id], (err, result) => {
        if (err || result.length === 0) {
            return res.status(400).json({ error: "Invalid teacher_id" });
        }
        db.query(
            "INSERT INTO classes (class_id, teacher_id, class_name, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
            [class_id, teacher_id, class_name, latitude, longitude],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: "Database error" });
                }
                res.json({ message: "Class created successfully!" });
            }
        );
    });
});

app.post('/mark-attendance', (req, res) => {
    const { student_id, roll_no, class_id, student_lat, student_lon } = req.body;

    
    if (!student_id || !roll_no || !class_id || !student_lat || !student_lon) {
        console.log("❌ Missing fields:", req.body);
        return res.status(400).json({ error: "All fields are required!" });
    }

    
    db.query("SELECT latitude, longitude FROM classes WHERE class_id = ?", [class_id], (err, result) => {
        if (err || result.length === 0) {
            console.log("❌ Invalid Class ID:", class_id);
            return res.status(400).json({ error: "Invalid class ID" });
        }

        const classLocation = result[0];
        const distance = require('geolib').getDistance(
            { latitude: student_lat, longitude: student_lon },
            { latitude: classLocation.latitude, longitude: classLocation.longitude }
        );

        if (distance > 5) {
            console.log(`❌ Student too far: ${distance} meters away`);
            return res.status(400).json({ error: "You are not in the class location" });
        }

        
        db.query("INSERT INTO attendance (student_id, roll_no, class_id) VALUES (?, ?, ?)", 
            [student_id, roll_no, class_id], (err) => {
                if (err) {
                    console.error("❌ Database Error:", err);
                    return res.status(500).json({ error: "Database error" });
                }
                console.log(`✅ Attendance marked: ${student_id} - ${roll_no} for class ${class_id}`);
                res.json({ message: "Attendance marked successfully!" });
            }
        );
    });
});

app.post('/approve-leave', (req, res) => {
    const { leave_id, status } = req.body;
    if (!leave_id || !['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: "Invalid request" });
    }
    db.query("UPDATE duty_leaves SET status = ? WHERE id = ?", [status, leave_id], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ message: `Leave ${status.toLowerCase()} successfully!` });
    });
});

app.get('/get-leave-requests', (req, res) => {
    db.query("SELECT * FROM duty_leaves WHERE status = 'Pending'", (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        console.log("Pending Leave Requests:", results); 
        res.json(results);
    });
});
app.get('/get-classes/:teacher_id', (req, res) => {
    const { teacher_id } = req.params;

    db.query("SELECT * FROM classes WHERE teacher_id = ?", [teacher_id], (err, result) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(result);
    });
});
app.get('/class-details/:class_id', (req, res) => {
    const { class_id } = req.params;

    const attendanceQuery = "SELECT student_id FROM attendance WHERE class_id = ?";
    const leavesQuery = "SELECT student_id, leave_date FROM duty_leaves WHERE class_id = ? AND status = 'Approved'";

    db.query(attendanceQuery, [class_id], (err, attendance) => {
        if (err) return res.status(500).json({ error: "Database error" });

        db.query(leavesQuery, [class_id], (err, leaves) => {
            if (err) return res.status(500).json({ error: "Database error" });

            res.json({ attendance, approved_leaves: leaves });
        });
    });
});
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: './public/uploads/', 
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        const fileTypes = /jpeg|jpg|png/;
        const extName = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = fileTypes.test(file.mimetype);
        if (mimeType && extName) {
            return cb(null, true);
        } else {
            cb(new Error("Only .jpeg, .jpg, .png images are allowed!"));
        }
    }
}).single('id_card_image');
app.post('/request-leave', upload, (req, res) => { 
  
    if (!req.file) {
        return res.status(400).json({ error: "ID card image upload failed!" });
    }

    const { student_id, class_id, leave_date, reason } = req.body;
    const id_card_image = `/uploads/${req.file.filename}`;

    if (!student_id || !class_id || !leave_date || !reason) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const sql = "INSERT INTO duty_leaves (student_id, class_id, leave_date, reason, id_card_image, status) VALUES (?, ?, ?, ?, ?, 'Pending')";
    db.query(sql, [student_id, class_id, leave_date, reason, id_card_image], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ message: "Leave request submitted successfully!", image: id_card_image });
    });
});

app.get('/get-leave-requests', (req, res) => {
    db.query("SELECT * FROM duty_leaves WHERE status = 'Pending'", (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(results);
    });
});


const QRCode = require("qrcode");



app.get("/generate-qr", async (req, res) => {
    try {
        const qrData = "Class QR Code - " + Date.now();
        const qrImage = await QRCode.toDataURL(qrData); 

        res.json({ qrImage }); 
    } catch (err) {
        res.status(500).json({ error: "QR Code generation failed!" });
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
