<?php
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

$token = $_GET['token'] ?? '';
$valid = false;
$email = '';

// Show form to enter email if no token is provided
if (empty($token)) {
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Forgot Password</title>
  <style>
    body {
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 10s ease infinite;
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

@keyframes gradientFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}


input::placeholder {
    color: #999;
    padding-left: 2px; /* Optional tweak to center more nicely */
}

*, *::before, *::after {
    box-sizing: border-box;
}

.form-container input {
    padding: 10px 12px;
}
input {
    text-align: left;
}
.form-container button {
    padding: 10px 12px; /* Add side padding for better spacing */
}


    .form-container {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 20px;
  padding: 30px 25px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 400px;
  width: 100%;
}

    .form-container h2 {
        color: #74bcd9;
        margin-bottom: 20px;
    }
    .form-container input {
        width: 100%;
        padding: 10px;
        margin-bottom: 15px;
        border: 1px solid #ccc;
        border-radius: 5px;
    }
    .form-container button {
        width: 100%;
        padding: 10px;
        background-color: #f7a4c4;
        border: none;
        color: white;
        font-weight: bold;
        border-radius: 5px;
        cursor: pointer;
    }
    .form-container button:hover {
        background-color: #f48bbd;
    }
    .error-message {
        background-color: #fff0f3;
        color: #d8000c;
        padding: 10px;
        border: 1px solid #ffd2d2;
        border-radius: 5px;
        margin-bottom: 15px;
        text-align: center;
    }

    label {
    display: block;
    margin-bottom: 5px;
    text-align: left; /* Align label text left inside centered container */
    font-size: 14px;
}
input {
    font-size: 14px;
}
    
    .success-message {
        color: green;
        text-align: center;
        margin-bottom: 15px;
    }
  </style>
</head>
<body>
  <div class="form-container">
    <h2>Forgot Password</h2>

    <?php if (isset($_GET['error'])): ?>
      <div class="error-message"><?= htmlspecialchars($_GET['error']) ?></div>
    <?php endif; ?>

    <?php if (isset($_GET['success'])): ?>
      <div class="success-message">
        <?= htmlspecialchars($_GET['success']) ?>
      </div>
    <?php endif; ?>

    <form method="POST" action="send_reset.php">
      <label for="email">Enter your FIT Email:</label>
      <input type="email" name="email" placeholder="e.g. kdmangahas@fit.edu.ph" required>
      <button type="submit">Send Reset Link</button>
    </form>
  </div>
</body>
</html>
<?php
exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['token'];
    $new_password = $_POST['password'];
    $confirm_password = $_POST['confirm'];

    if ($new_password !== $confirm_password) {
        $error = "Passwords do not match.";
    } else {
        $stmt = $conn->prepare("SELECT email FROM user_login WHERE reset_token = ? AND reset_token_expiry > NOW()");
        $stmt->bind_param("s", $token);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($user = $result->fetch_assoc()) {
            $email = $user['email'];
            $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);

            $stmt = $conn->prepare("UPDATE user_login SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE email = ?");
            $stmt->bind_param("ss", $hashed_password, $email);
            $stmt->execute();

            echo "
            <!DOCTYPE html>
            <html lang='en'>
            <head>
              <meta charset='UTF-8'>
              <title>Password Reset Successful</title>
              <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #fef6fb;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }
                .form-container {
                    background-color: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 400px;
                    width: 100%;
                }
                .form-container h2 {
                    color: #74bcd9;
                    margin-bottom: 20px;
                }
                .button-link {
                    display: inline-block;
                    margin-top: 20px;
                    padding: 10px 20px;
                    background-color: #f7a4c4;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                }
                .button-link:hover {
                    background-color: #f48bbd;
                }
              </style>
            </head>
            <body>
              <div class='form-container'>
                <h2>🎉 Password Reset!</h2>
                <p>Your password has been successfully updated.</p>
                <a href='login.php' class='button-link'>👉 Log in now</a>
              </div>
            </body>
            </html>";
            exit;
        } else {
            $error = "Invalid or expired token.";
        }
    }
} else {
    $stmt = $conn->prepare("SELECT email FROM user_login WHERE reset_token = ? AND reset_token_expiry > NOW()");
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->fetch_assoc()) {
        $valid = true;
    } else {
        $error = "Invalid or expired token.";
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reset Password</title>
  <style>
    body {
        font-family: Arial, sans-serif;
        background-color: #fef6fb;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
    }
    .form-container {
        background-color: white;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        max-width: 400px;
        width: 100%;
    }
    h2 {
        color: #74bcd9;
        margin-bottom: 20px;
        text-align: center;
    }
    label {
        display: block;
        margin-bottom: 5px;
        color: #444;
    }
    input {
        width: 100%;
        padding: 10px;
        margin-bottom: 15px;
        border: 1px solid #ccc;
        border-radius: 5px;
    }
    button {
        width: 100%;
        padding: 10px;
        background-color: #f7a4c4;
        border: none;
        color: white;
        font-weight: bold;
        border-radius: 5px;
        cursor: pointer;
    }
    button:hover {
        background-color: #f48bbd;
    }
    .error-message {
        background-color: #fff0f3;
        color: #d8000c;
        padding: 10px;
        border: 1px solid #ffd2d2;
        border-radius: 5px;
        margin-bottom: 15px;
        text-align: center;
    }
  </style>
</head>
<body>
<div class="form-container">
  <h2>Reset Password</h2>

  <?php if (isset($error)): ?>
    <div class="error-message"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <?php if ($valid || $_SERVER['REQUEST_METHOD'] === 'POST'): ?>
    <form method="POST">
      <input type="hidden" name="token" value="<?= htmlspecialchars($token) ?>">

      <label for="password">New Password:</label>
      <input type="password" name="password" placeholder="Enter new password" required>

      <label for="confirm">Confirm Password:</label>
      <input type="password" name="confirm" placeholder="Repeat new password" required>

      <button type="submit">Reset Password</button>
    </form>
  <?php endif; ?>
</div>
</body>
</html>
