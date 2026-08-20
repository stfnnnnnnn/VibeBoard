<?php 
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
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to VibeBoard</title>
  <style>
    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', sans-serif;
      height: 100vh;
      overflow: hidden;
    }

    body {
      background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
      background-size: 300% 300%;
      animation: gradientFlow 10s ease infinite;
    }

    @keyframes gradientFlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .panel-wrapper {
      display: flex;
      width: 100%;
      height: 100vh;
      position: relative;
      transition: all 0.4s ease;
    }

    .auth-panel {
      width: 25%;
      min-width: 260px;
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(12px);
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-right: 1px solid rgba(255, 255, 255, 0.2);
      border-top-right-radius: 40px;
      border-bottom-right-radius: 40px;
      transform: translateX(-100%);
      transition: transform 0.4s ease;
      position: absolute;
      height: 100%;
      z-index: 5;
    }

    .panel-wrapper.auth-visible .auth-panel {
      transform: translateX(0);
    }

    .main-panel {
  width: 100%;
  padding: 5px 80px 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center; /* center horizontally */
  text-align: left;  /* optional */
  color: #333;
  overflow-y: auto;
  transition: all 0.4s ease;
}

.panel-wrapper.auth-visible .main-panel {
  width: 75%;
  margin-left: 25%;
  align-items: flex-start;
  text-align: left;
}


    .panel-wrapper.auth-visible .main-panel {
      margin-left: 25%;
    }

    .toggle-button {
      position: absolute;
      top: 20px;
      left: 20px;
      font-size: 24px;
      background: rgba(255, 255, 255, 0.5);
      border: none;
      padding: 10px 16px;
      border-radius: 10px;
      cursor: pointer;
      z-index: 10;
      transition: background 0.3s ease;
    }

    .toggle-button:hover {
      background: rgba(255, 255, 255, 0.8);
    }

    .main-panel h1 {
      font-size: 74px;
      margin-bottom: 20px;
      max-width: 1000px;
      line-height: 1.2;
      background: linear-gradient(to right, #f2a7c0, #74bcd9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: fadeIn 1s ease-out forwards;
      transition: font-size 0.3 ease;
    }

    .main-panel p {
      text-align: left;
      margin-top: 20px;
      font-size: 18px;
      max-width: 1000px;
      padding: 16px 24px;
      border-radius: 14px;
      background: linear-gradient(90deg, rgba(116,188,217,0.2), rgba(242,167,192,0.2));
      font-weight: 500;
      color: #444;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 40px;
      margin-top: 20px;
      max-width: 1000px;
      margin-left: auto;
      margin-right: auto;
    }

    .feature-item {
      background: rgba(255,255,255,0.25);
      border-radius: 16px;
      padding: 20px;
      text-align: center;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
      color: #333;
      overflow: hidden;
      height: 115px;
    }

    .feature-item:hover {
      height: 160px;
      padding: 20px 20px 40px 20px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.1);
    }

    .feature-icon svg {
      width: 36px;
      height: 36px;
    }

    .pink { fill: #e88aa8; }
    .blue { fill: #5fa8cc; }

    .feature-title-pink {
      margin-top: 5px;
      color: #e88aa8;
      font-size: 16px;
      font-weight: bold;
    }

    .feature-title-blue {
      margin-top: 5px;
      font-size: 16px;
      color: #5fa8cc;
      font-weight: bold;
    }

    .feature-desc-pink,
    .feature-desc-blue {
      text-align: left;
      width: fit-content;
      margin-top: 12px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.3s ease;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
    }

.feature-item:nth-child(3) .feature-desc-pink {
  margin-left: 15px;
}

.feature-item:nth-child(4) .feature-desc-blue {
  margin-left: 15px;
}
    .feature-desc-pink {
      color: #e88aa8;
    }

    .feature-desc-blue {
      margin-left: auto;
      margin-right: auto;
      color: #5fa8cc;
    }

    .feature-item:hover .feature-desc-pink,
    .feature-item:hover .feature-desc-blue {
      opacity: 1;
    }

          .panel-wrapper.auth-visible .main-panel h1 {
        font-size: 70px;
      }

    @media (max-width: 768px) {
      .auth-panel {
        position: fixed;
        width: 100%;
        height: auto;
        top: 0;
        left: 0;
        border-radius: 0;
        flex-direction: row;
        justify-content: space-around;
        padding: 20px;
        transform: translateY(-100%);
      }

      .panel-wrapper.auth-visible .auth-panel {
        transform: translateY(0);
      }

      .main-panel {
        padding: 30px;
        margin-left: 0 !important;
      }
    }

    .logo {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 20px;
    }

    .logo span:first-child { color: #f2a7c0; }
    .logo span:last-child { color: #74bcd9; }

    .button-link-blue,
    .button-link-pink {
      display: block;
      width: 100%;
      text-align: center;
      padding: 12px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: bold;
      margin: 10px 0;
      font-size: 15px;
      transition: background-color 0.3s ease;
      color: white;
    }

    .button-link-blue {
      background-color: #91cbe6;
    }

    .button-link-blue:hover {
      background-color: #5fa8cc;
    }

    .button-link-pink {
      background-color: #f2a7c0;
    }

    .button-link-pink:hover {
      background-color: #e68dac;
    }
  </style>
</head>
<body>
  <div class="panel-wrapper">
    <div class="auth-panel">
      <div class="logo"><span>Vibe</span><span>Board</span></div>
      <a href="signup.php" class="button-link-pink">Sign Up</a>
      <a href="login.php" class="button-link-blue">Log In</a>
    </div>

    <div class="main-panel">
      <button id="toggle-auth" class="toggle-button">☰</button>

      <h1>
        <span>Bring Colors to Your</span><br>
        <span>Productivity With VibeBoard</span>
      </h1>

      <p><strong>VibeBoard</strong> is your personal, visual-first student dashboard designed to organize tasks, grades, finances, and habits into one sleek platform. Built by students, for students, it simplifies your academic life while reflecting your personality.</p>

      <div class="feature-grid">
        <div class="feature-item">
          <div class="feature-icon">
            <svg class="pink" viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.5-1.5z"/></svg>
          </div>
          <div class="feature-title-pink">Tasks</div>
          <div class="feature-desc-pink">Track classes, to-dos, and upcoming deadlines — all in one place.</div>
        </div>

        <div class="feature-item">
          <div class="feature-icon">
            <svg class="blue" viewBox="0 0 24 24"><path d="M3 17h2v-7H3v7zm4 0h2v-4H7v4zm4 0h2v-10h-2v10zm4 0h2v-6h-2v6zm4 0h2v-2h-2v2z"/></svg>
          </div>
          <div class="feature-title-blue">Grades</div>
          <div class="feature-desc-blue">Stay updated on scores and progress across all your subjects.</div>
        </div>

        <div class="feature-item">
          <div class="feature-icon">
            <svg class="pink" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5
              2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09
              C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5
              c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </div>
          <div class="feature-title-pink">Habits</div>
          <div class="feature-desc-pink">Build routines, set daily goals, and track your personal growth.</div>
        </div>

        <div class="feature-item">
          <div class="feature-icon">
            <svg class="blue" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2
              12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0
              18c-4.41 0-8-3.59-8-8s3.59-8
              8-8 8 3.59 8 8-3.59 8-8
              8zm-1-13h2v2h-2zm0
              4h2v6h-2z"/></svg>
          </div>
          <div class="feature-title-blue">Finances</div>
          <div class="feature-desc-blue">Manage spending, set budgets, and keep your money organized.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const toggleBtn = document.getElementById("toggle-auth");
    const panelWrapper = document.querySelector(".panel-wrapper");

    toggleBtn.addEventListener("click", () => {
      panelWrapper.classList.toggle("auth-visible");
    });
  </script>
</body>
</html>
