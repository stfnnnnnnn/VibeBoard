<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header("Location: forgot_password.php");
    exit();
}

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

$email = trim($_POST['email']);

if (
    !filter_var($email, FILTER_VALIDATE_EMAIL) ||
    (
        $email !== 'kristinea1220@gmail.com' &&
        $email !== 'takagikiyohito@gmail.com' &&
        !preg_match(
            '/^[a-z]{2}[a-z]{1,28}@fit\.edu\.ph$'
            . '|^2[0-9]{3}[0-9]{5}@feu\.edu\.ph$'
            . '|^[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+\.[a-zA-Z]{1,5}@ust\.edu\.ph$'
            . '|^2[0-5][0-9]{5}@ceu\.edu\.ph$'
            . '|^[a-zA-Z0-9._%+-]+@lanting\.ph\.education$/',
            $email
        )
    )
) {
    header("Location: forgot_password.php?error=" . urlencode("Please enter a valid school or approved email address."));
    exit();
}



// Check if email exists
$stmt = $conn->prepare("SELECT user_id FROM user_login WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$result = $stmt->get_result();

if ($user = $result->fetch_assoc()) {
    // Generate token
    $token = bin2hex(random_bytes(32));
    $expiry = date("Y-m-d H:i:s", time() + 3600); // 1 hour expiry

    // Store in DB
    $stmt = $conn->prepare("UPDATE user_login SET reset_token = ?, reset_token_expiry = ? WHERE email = ?");
    $stmt->bind_param("sss", $token, $expiry, $email);
    $stmt->execute();

    // Email link
    $resetLink = "http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['REQUEST_URI']) . "/forgot_password.php?token=$token";

    $subject = "Password Reset Request";
    $message = "Hi,\n\nWe received a request to reset your password. Click the link below to set a new password:\n\n$resetLink\n\nIf you did not request this, you can ignore this email.\n\nThanks,\nVibeBoard Team";
    $headers = "From: no-reply@vibeboard.com";

    // Send email
    mail($email, $subject, $message, $headers);
}

header("Location: forgot_password.php?success=" . urlencode("If the email is valid, a reset link has been sent."));
exit();
?>
