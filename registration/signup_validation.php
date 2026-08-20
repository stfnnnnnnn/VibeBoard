<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

function sanitize_input($data) {
    return htmlspecialchars(stripslashes(trim($data)));
}

function show_error($message) {
    echo "
    <!DOCTYPE html>
    <html lang='en'>
    <head>
      <meta charset='UTF-8'>
      <title>Sign Up Error</title>
      <link rel='preconnect' href='https://fonts.googleapis.com'>
      <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>
      <link href='https://fonts.googleapis.com/css2?family=Segoe+UI&display=swap' rel='stylesheet'>
      <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', sans-serif;
            background-color: #fef6fb;
            color: #333;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }

        .form-container {
            background-color: #ffffff;
            padding: 40px 50px;
            border-radius: 20px;
            box-shadow: 0 8px 24px rgba(100, 100, 111, 0.15);
            width: 400px;
            max-width: 90%;
        }

        .error-message {
            color: #d8000c;
            background-color: #fff0f3;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid #ffd2d2;
            margin-bottom: 18px;
            text-align: center;
        }

        .redirect {
            text-align: center;
            margin-top: 15px;
            font-size: 14px;
            color: #666;
        }

        .redirect a {
            color: #74bcd9;
            text-decoration: none;
            font-weight: 500;
        }

        .redirect a:hover {
            text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class='form-container'>
        <div class='error-message'>⚠️ $message</div>
        <div class='redirect'>
          <a href='signup.php'>← Back to Sign Up</a>
        </div>
      </div>
    </body>
    </html>";
    exit;
}


if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    show_error("Invalid request method.");
}

// Input
$first_name     = sanitize_input($_POST['first_name']);
$middle_name    = sanitize_input($_POST['middle_name']);
$surname        = sanitize_input($_POST['surname']);
$dateofbirth    = sanitize_input($_POST['dateofbirth']);
$email          = sanitize_input($_POST['email']);
$year_level     = sanitize_input($_POST['year_level']);
$status         = sanitize_input($_POST['status']);
$program_code   = sanitize_input($_POST['program']);
$specialization_name = sanitize_input($_POST['specialization']);
$password       = $_POST['password'];
$confirm        = $_POST['confirm'];

// Age check
$dob = DateTime::createFromFormat('Y-m-d', $dateofbirth);
$today = new DateTime();
$age = $today->diff($dob)->y;
if ($age < 15 || $age > 100) {
    show_error("Age must be between 15 and 100.");
}

// Password match
if ($password !== $confirm) {
    show_error("Password and confirmation do not match.");
}

// Email format
if (
    $email !== "kristinea1220@gmail.com" &&
    $email !== "takagikiyohito@gmail.com" &&
    !preg_match(
        '/^[a-z]{2}[a-z]{1,28}@fit\.edu\.ph$'                           // FIT two-letter + surname
        . '|^2[0-9]{3}[0-9]{5}@feu\.edu\.ph$'                         // FEU two-letter + surname
        . '|^[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+\.[a-zA-Z]{1,5}@ust\.edu\.ph$' // UST
        . '|^2[0-5][0-9]{5}@ceu\.edu\.ph$'                              // CEU numeric
        . '|^[a-zA-Z0-9._%+-]+@lanting\.ph\.education$/',               // Lanting
        $email
    )
) {
    header("Location: login.php?error=" . urlencode("Invalid email format. Only FIT, FEU, UST, CEU, Lanting, or approved emails allowed."));
    exit();
}

// Lookup program ID
$program_name_map = [
    'BSCS' => 'Bachelor of Science in Computer Science',
    'BSIT' => 'Bachelor of Science in Information Technology',
    'BMMA' => 'Bachelor of Multimedia Arts',
    'BSCyber' => 'Bachelor of Science in Cybersecurity',
    'BSDMM' => 'Bachelor of Digital Marketing and Management',
    'BSFTE' => 'BS in Financial Technology Engineering Program',
    'BSPT' => 'Bachelor of Science in Physical Therapy', // ✅ PT

    // ✅ Dentistry programs
    'DMD-General' => 'Doctor of Dental Medicine - General Dentistry',
    'DMD-Orthodontics' => 'Doctor of Dental Medicine - Orthodontics',
    'DMD-Prosthodontics' => 'Doctor of Dental Medicine - Prosthodontics',
    'DMD-Endodontics' => 'Doctor of Dental Medicine - Endodontics',
    'DMD-Periodontics' => 'Doctor of Dental Medicine - Periodontics',
    'DMD-Pediatric' => 'Doctor of Dental Medicine - Pediatric Dentistry',
    'DMD-OralSurgery' => 'Doctor of Dental Medicine - Oral Surgery',
    'DMD-Pathology' => 'Doctor of Dental Medicine - Oral Pathology',
    'DMD-PublicHealth' => 'Doctor of Dental Medicine - Public Health Dentistry',
    'DMD-Radiology' => 'Doctor of Dental Medicine - Oral & Maxillofacial Radiology',
    'BSMT' => 'Bachelor of Science in Medical Technology',
    'DO' => 'Doctor of Optometry',
    'BSN' => 'Bachelor of Science in Nursing'
];

if (!array_key_exists($program_code, $program_name_map)) {
    show_error("Invalid program selected.");
}

$program_name = $program_name_map[$program_code];
$stmt = $conn->prepare("SELECT program_id FROM programs WHERE program_name = ?");
$stmt->bind_param("s", $program_name);
$stmt->execute();
$result = $stmt->get_result();
if ($row = $result->fetch_assoc()) {
    $program_id = $row['program_id'];
} else {
    show_error("Program not found in database.");
}
$stmt->close();

// Specialization
if ($specialization_name === "No Specialization") {
    $specialization_id = null;
} else {
    $stmt = $conn->prepare("SELECT specialization_id FROM specializations WHERE specialization_name = ? AND program_id = ?");
    $stmt->bind_param("si", $specialization_name, $program_id);
    $stmt->execute();
    $result = $stmt->get_result();
    if ($row = $result->fetch_assoc()) {
        $specialization_id = $row['specialization_id'];
    } else {
        show_error("Specialization not found for selected program.");
    }
    $stmt->close();
}

// Password hash
$hashed_password = password_hash($password, PASSWORD_DEFAULT);

// Insert
$stmt = $conn->prepare("INSERT INTO user_login (
    first_name, middle_name, surname, dateofbirth, email,
    year_level, status, program, specialization, password
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

$stmt->bind_param(
    "sssisssiis",
    $first_name,
    $middle_name,
    $surname,
    $dateofbirth,
    $email,
    $year_level,
    $status,
    $program_id,
    $specialization_id,
    $hashed_password
);

// Success or error output (wrapped in full HTML)
if ($stmt->execute()) {
    echo "
    <!DOCTYPE html>
    <html lang='en'>
    <head>
      <meta charset='UTF-8'>
      <title>Sign Up Success</title>
      <link rel='preconnect' href='https://fonts.googleapis.com'>
      <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>
      <link href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap' rel='stylesheet'>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: 'Poppins', sans-serif;
          background: linear-gradient(145deg, #fef6fb, #e6f6ff);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }

        .card {
          background: #ffffff;
          padding: 40px 35px;
          border-radius: 28px;
          box-shadow: 0 12px 24px rgba(100, 100, 111, 0.12);
          max-width: 440px;
          width: 90%;
          text-align: center;
          color: #333;
        }

        .card h1 {
          font-size: 26px;
          font-weight: 600;
        }
        
      .success-heading span:nth-child(1),
.success-heading span:nth-child(3) {
  color: #f2a7c0;
  animation: softPinkGlow 3s ease-in-out infinite;
}

.success-heading span:nth-child(2),
.success-heading span:nth-child(4) {
  color: #74bcd9;
  animation: softBlueGlow 3s ease-in-out infinite;
}


        .details {
          font-size: 15px;
          line-height: 1.6;
          text-align: left;
          margin-bottom: 30px;
        }

        .details p {
          margin: 10px 0;
        }

        .highlight {
          background-color: #e0f0ff;
          padding: 2px 6px;
          border-radius: 6px;
        }

        .highlight.pink {
          background-color: #ffe5f0;
        }

        .button-link {
            display: inline-block;
            background-color: #f7a4c4; /* pastel pink */
            color: white;
            text-decoration: none;
            padding: 12px 36px;
            border-radius: 999px; /* pill shape */
            font-weight: 600;
            font-size: 14px;
            transition: background-color 0.3s ease, transform 0.2s ease;
            box-shadow: 0 4px 12px rgba(247, 164, 196, 0.3);
        }

        .button-link:hover {
            background-color: #f48bbd; /* darker pink on hover */
            text-decoration: none;
            transform: translateY(-1px);
        }

      </style>
    </head>
    <body>
      <div class='card'>
<h2 class='success-heading'>
  <span>Create</span><span> Your</span>
  <span>VibeBoard</span><span> Account</span>
</h2>
        <div class='details'>
          <p><strong>Name:</strong> <span class='highlight pink'>$first_name $middle_name $surname</span></p>
          <p><strong>Email:</strong> <span class='highlight'>$email</span></p>
          <p><strong>Date of Birth:</strong> <span class='highlight pink'>$dateofbirth</span></p>
          <p><strong>Year Level:</strong> <span class='highlight'>$year_level</span></p>
          <p><strong>Status:</strong> <span class='highlight pink'>$status</span></p>
          <p><strong>Program:</strong> <span class='highlight'>$program_name</span></p>
          <p><strong>Specialization:</strong> <span class='highlight pink'>$specialization_name</span></p>
       </div>
        <div class='redirect'>
          <a href='login.php' class='button-link'>Click here to log in</a>
        </div>
      </div>
    </body>
    </html>";
} else {
    if ($conn->errno === 1062) {
        show_error("Email already exists.");
    } else {
        show_error($stmt->error);
    }
}

$stmt->close();
$conn->close();
?>
