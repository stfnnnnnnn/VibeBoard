<?php
session_start([
    'cookie_httponly' => true,
    'cookie_secure' => isset($_SERVER['HTTPS']),
    'cookie_samesite' => 'Strict'
]);

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

function sanitize_input($data) {
    return htmlspecialchars(trim($data));
}

// Block if not POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header("Location: login.php?error=" . urlencode("Invalid request method."));
    exit();
}

$maxAttempts = 5;
$blockDuration = 10; // minutes

// Get inputs
$email = sanitize_input($_POST['email']);
$password = $_POST['password'];
$remember = isset($_POST['remember']);

// Validate FIT email
if (
    $email !== "kristinea1220@gmail.com" &&
    $email !== "takagikiyohito@gmail.com" &&
    !preg_match(
        '/^[a-z]{2}[a-z]{1,28}@fit\.edu\.ph$|' .                        // FIT two-letter + surname
        '^2[0-9]{3}[0-9]{5}@feu\.edu\.ph$|' .                        // FEU two-letter + surname
        '^[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+\.[a-zA-Z]{1,5}@ust\.edu\.ph$|' . // UST format
        '^2[0-5][0-9]{5}@ceu\.edu\.ph$|' .                             // CEU numeric
        '^[a-zA-Z0-9._%+-]+@lanting\.ph\.education$/',                 // Lanting
        $email
    )
) {
    header("Location: login.php?error=" . urlencode("Invalid email format. Only FIT, FEU, UST, CEU, Lanting, or approved emails allowed."));
    exit();
}


// Fetch user and attempt info
$stmt = $conn->prepare("
    SELECT user_id, password, first_name, failed_attempts, last_attempt 
    FROM user_login 
    WHERE email = ?
");
$stmt->bind_param("s", $email);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows === 1) {
    $user = $result->fetch_assoc();

    // Check if user is blocked
    if ($user['failed_attempts'] >= $maxAttempts && strtotime($user['last_attempt']) > strtotime("-$blockDuration minutes")) {
        header("Location: login.php?error=" . urlencode("Too many failed attempts. Try again later."));
        exit();
    }

    // Verify password
    if (password_verify($password, $user['password'])) {
        // ✅ Login successful → reset failed attempts
        $update = $conn->prepare("UPDATE user_login SET failed_attempts = 0, last_attempt = NULL WHERE user_id = ?");
        $update->bind_param("i", $user['user_id']);
        $update->execute();

        $_SESSION['user_id'] = $user['user_id'];
        $_SESSION['first_name'] = $user['first_name'];

        if ($remember) {
            setcookie("remember_email", $email, time() + (7 * 86400), "/", "", isset($_SERVER['HTTPS']), true);
        }

        header("Location: /VibeBoard/dashboard/dashboard.php");
        exit();
    } else {
        // ❌ Wrong password → increment failed attempts
        $update = $conn->prepare("
            UPDATE user_login 
            SET failed_attempts = failed_attempts + 1, 
                last_attempt = NOW() 
            WHERE email = ?
        ");
        $update->bind_param("s", $email);
        $update->execute();
    }
}

// Either user not found or wrong password
header(("Location: /VibeBoard/dashboard/dashboard.php") . urlencode("Invalid email or password."));
exit();
