<?php
session_start();
$error = $_GET['error'] ?? '';
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Login</title>
  <style>

    * {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  overflow-x: hidden;
}
    /* 🌸 Base Layout */
        body {
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', sans-serif;
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 10s ease infinite;
  color: #333;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

/* 🎨 Animate gradient flow */
@keyframes gradientFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* 🧊 Glassmorphic form container */
.form-container {
  margin-top: 100px;
  margin-bottom: 100px;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  text-align: left;
  padding: 40px 50px;
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  width: 500px;
  max-width: 90%;
}

    h1 {
      text-align: center;
      margin-bottom: 30px;
      font-weight: 600;
    }
    .text {
  font-size: 40px;
  font-weight: 700;
  text-align: center;
  display: inline-block;
    }

    .text span:nth-child(1) {
      color: #f2a7c0;
      animation: softPinkGlow 3s ease-in-out infinite;
    }

    .text span:nth-child(2) {
      color: #92a8d0;
      animation: softBlueGlow 3s ease-in-out infinite;
    }

    .text span:nth-child(3) {
      color: #92a8d0;
      animation: softPinkGlow 3s ease-in-out infinite;
    }

    .text span:nth-child(4) {
      color: #f2a7c0;
      animation: softBlueGlow 3s ease-in-out infinite;
    }

    /* 🧾 Labels and Inputs */
    form label {
        display: block;
        margin-bottom: 6px;
        color: #444;
        font-size: 14px;
    }

    form input,
    form select {
        width: 100%;
        padding: 10px 12px;
        margin-bottom: 18px;
        border: 1px solid #ddd;
        border-radius: 10px;
        background-color: #fafafa;
        font-size: 14px;
        color: #333;
        transition: border-color 0.2s ease;
    }

    form input::placeholder,
    form select {
        color: #aaa;
    }

    form input:focus,
    form select:focus {
        outline: none;
        border-color: #f7a4c4;
        box-shadow: 0 0 0 3px rgba(247, 164, 196, 0.3);
    }

    form input:not(:placeholder-shown):not([type="date"]) {
        background-color: #e0f0ff;
        border-color: #74bcd9;
    }

    form select:valid {
        background-color: #e0f0ff;
        border-color: #74bcd9;
        color: #333;
    }

    input[type="date"]:valid {
        background-color: #e0f0ff;
        border-color: #74bcd9;
        color: black;
    }

    input[type="date"]:invalid {
        background-color: #fafafa;
        border-color: #ddd;
        color: gray;
    }

    /* 🎀 Button */
    button {
        width: 100%;
        padding: 12px;
        background-color: #f7a4c4;
        border: none;
        border-radius: 10px;
        color: #ffffff;
        font-weight: bold;
        font-size: 15px;
        cursor: pointer;
        transition: background-color 0.3s ease;
    }

    button:hover {
        background-color: #f48bbd;
    }

    /* 🔗 Redirect */
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

    /* ⚠️ Error Message */
    .error-message {
        color: #d8000c;
        background-color: #fff0f3;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid #ffd2d2;
        margin-bottom: 18px;
        text-align: center;
    }

    /* ✅ Remember Me Checkbox */
    .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
        font-size: 14px;
        color: #555;
    }

    .checkbox-row input[type="checkbox"] {
        accent-color: #74bcd9;
        transform: scale(1.1);
    }

    /* 🔐 Password Visibility Toggle */
    .password-wrapper {
        position: relative;
    }

    .toggle-password {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        cursor: pointer;
        color: #bbb;
        font-size: 18px;
    }

    button.loading::after {
        content: '...';
        animation: dots 1s steps(3, end) infinite;
    }

    @keyframes dots {
        0% { content: ''; }
        33% { content: '.'; }
        66% { content: '..'; }
        100% { content: '...'; }
    }

    .button-link {
        display: inline-block;
        padding: 10px 20px;
        background-color: #f7a4c4;
        color: white;
        font-weight: bold;
        border-radius: 25px;
        text-decoration: none;
        transition: background-color 0.3s ease;
    }

    .button-link:hover {
        background-color: #f48bbd;
    }

    .login-options {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 18px;
        font-size: 14px;
        color: #555;
        padding: 0 2px;
    }

    .login-options .remember-label {
        display: flex !important;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
    }

    .login-options .remember-label input[type="checkbox"] {
        accent-color: #74bcd9;
        transform: scale(1.2);
        margin: 0;
        width: auto;
    }

    .forgot-link {
        text-decoration: none;
        color: #74bcd9;
        font-weight: 500;
        font-size: 14px;
        white-space: nowrap;
    }

    .forgot-link:hover {
        text-decoration: underline;
    }
  </style>
</head>
<body>
<div class="form-container">
  <h1 class="text">
    <span>Access</span><span> Your</span>
    <span>VibeBoard</span><span> Account</span>
  </h1>

  <?php if ($error): ?>
    <div class="error-message"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <form action="login_validation.php" method="POST">
    <label for="email">University Email:</label>
    <input type="email" name="email" placeholder="e.g. universityid@university.edu.ph" required>

    <label for="password">Password:</label>
    <div class="password-wrapper">
      <input type="password" name="password" placeholder="Enter your password" required>
    </div>

    <div class="login-options">
      <label class="remember-label" for="remember">
        <input type="checkbox" id="remember" name="remember">
        Remember me
      </label>
      <a class="forgot-link" href="forgot_password.php">Forgot Password?</a>
    </div>

    <button type="submit">Login</button>
  </form>

  <div class="redirect">
    Don’t have an account? <a href="signup.php">Sign up here</a>
  </div>
</div>
</body>
</html>
