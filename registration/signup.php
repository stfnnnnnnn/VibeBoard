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
  <meta charset="UTF-8">
  <title>Sign Up</title>
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
  text-align: center;
  padding: 40px 50px;
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  width: 500px;
  max-width: 100%;
}

/* --- Keep the rest of your CSS unchanged --- */
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


    
    form label {
        text-align: left;
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
        margin-left: auto;
        margin-right: auto;
        display: block;
        border: 1px solid #ddd;
        border-radius: 10px;
        background-color: #fafafa;
        font-size: 14px;
        color: #333;
        transition: border-color 0.2s ease;
    }

    form button{
        margin-left: auto;
        margin-right: auto;
        display: block;
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

    
    .error-message {
        color: #d8000c;
        background-color: #fff0f3;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid #ffd2d2;
        margin-bottom: 18px;
        text-align: center;
    }

    
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
    <span>Create</span><span> Your</span>
    <span>VibeBoard</span><span> Account</span>
  </h1>

  <form action="signup_validation.php" method="POST">
    <label for="first_name">First Name:</label>
    <input type="text" name="first_name" placeholder="e.g. Karl Stephen" required>

    <label for="middle_name">Middle Name:</label>
    <input type="text" name="middle_name" placeholder="e.g. Delos Santos">

    <label for="surname">Surname:</label>
    <input type="text" name="surname" placeholder="e.g. Mangahas" required>

    <div class="input-group">
        <label for="dateofbirth">Date of Birth:</label>
        <input type="date" name="dateofbirth" id="dateofbirth" required>
    </div>

    <label for="email">Your Email:</label>
    <input type="email" name="email" placeholder="e.g. kdmangahas@fit.edu.ph" required>

    <label for="year_level">Year Level:</label>
    <select name="year_level" required>
      <option value="" disabled selected>Select year level</option>
      <option>1st Year</option>
      <option>2nd Year</option>
      <option>3rd Year</option>
      <option>4th Year</option>
    </select>

    <label for="status">Status:</label>
    <select name="status" required>
      <option value="" disabled selected>Select status</option>
      <option>Regular</option>
      <option>Irregular</option>
    </select>

    <label for="program">Program:</label>
    <select name="program" id="program" onchange="updateSpecializations()" required>
      <option value="" disabled selected>Select program</option>
      <optgroup label="College of Computer Science">
        <option value="BSCS">Bachelor of Science in Computer Science</option>
      </optgroup>
      <optgroup label="College of Information Technology">
        <option value="BSIT">Bachelor of Science in Information Technology</option>
      </optgroup>
      <optgroup label="College of Multimedia Arts">
        <option value="BMMA">Bachelor of Science in Multimedia Arts</option>
      </optgroup>
      <optgroup label="College of Cybersecurity">
        <option value="BSCyber">Bachelor of Science in Cybersecurity</option>
      </optgroup>
      <optgroup label="College of Digital Marketing">
        <option value="BSDMM">Bachelor of Science in Digital Marketing and Management</option>
      </optgroup>
      <optgroup label="College of Financial Technology Engineering">
        <option value="BSFTE">Bachelor of Science in Financial Technology Engineering Program</option>
      </optgroup>
      <optgroup label="College of Rehabilitation Sciences">
        <option value="BSPT">Bachelor of Science Major in Physical Therapy</option>
       <optgroup label="School of Dentistry">
      <option value="DMD-General">Doctor of Dental Medicine - General Dentistry</option>
      <option value="DMD-Orthodontics">Doctor of Dental Medicine - Orthodontics</option>
      <option value="DMD-Prosthodontics">Doctor of Dental Medicine - Prosthodontics</option>
      <option value="DMD-Endodontics">Doctor of Dental Medicine - Endodontics</option>
      <option value="DMD-Periodontics">Doctor of Dental Medicine - Periodontics</option>
      <option value="DMD-Pediatric">Doctor of Dental Medicine - Pediatric Dentistry</option>
      <option value="DMD-OralSurgery">Doctor of Dental Medicine - Oral Surgery</option>
      <option value="DMD-Pathology">Doctor of Dental Medicine - Oral Pathology</option>
      <option value="DMD-PublicHealth">Doctor of Dental Medicine - Public Health Dentistry</option>
      <option value="DMD-Radiology">Doctor of Dental Medicine - Oral & Maxillofacial Radiology</option>
      </optgroup>
      <optgroup label="College of Medicine">
        <option value="BSMT">Bachelor of Science in Medical Technology</option>
      </optgroup>
      <optgroup label="College of Optometry">
        <option value="DO">Doctor of Optometry</option>
  </optgroup>
      <optgroup label="Institue of Health Sciences and Nursing">
        <option value="BSN">Bachelor of Science in Nursing</option>
      </optgroup>
  </select>
    <label for="specialization">Specialization:</label>
    <select name="specialization" id="specialization" required>
        <option value="" disabled selected>Select specialization</option>
    </select>

    <label for="password">Password:</label>
    <input type="password" name="password" placeholder="e.g. Sch00lstuffs!" required>

    <label for="confirm">Confirm Password:</label>
    <input type="password" name="confirm" placeholder="Repeat your password" required>

    <button type="submit">Sign Up</button>
  </form>

  <div class="redirect">
    Already have an account? <a href="login.php">Login here</a>
  </div>
</div>

<script>
  const specializations = {
  BSCS: [
    "Artificial Intelligence",
    "Data Science",
    "Software Engineering"
  ],
  BSIT: [
    "Cybersecurity",
    "Web and Mobile Application",
    "Animation and Game Development",
    "Business Analytics"
  ],
  BMMA: ["No Specialization"],
  BSCyber: ["No Specialization"],
  BSDMM: ["No Specialization"],
  BSFTE: ["No Specialization"],
  BSPT: ["No Specialization"], // ✅ Physical Therapy

  // ✅ Dentistry Programs (no specialization)
  "DMD-General": ["No Specialization"],
  "DMD-Orthodontics": ["No Specialization"],
  "DMD-Prosthodontics": ["No Specialization"],
  "DMD-Endodontics": ["No Specialization"],
  "DMD-Periodontics": ["No Specialization"],
  "DMD-Pediatric": ["No Specialization"],
  "DMD-OralSurgery": ["No Specialization"],
  "DMD-Pathology": ["No Specialization"],
  "DMD-PublicHealth": ["No Specialization"],
  "DMD-Radiology": ["No Specialization"],

  DO: ["No Specialization"],
  BSMT: ["No Specialization"],
  BSN:["No Specialization"]
};

  function updateSpecializations() {
    const programSelect = document.getElementById("program");
    const specializationSelect = document.getElementById("specialization");
    const selectedProgram = programSelect.value;

    
    specializationSelect.innerHTML = '';
    specializationSelect.disabled = false;

    if (specializations[selectedProgram]) {
        const specs = specializations[selectedProgram];

        if (specs.length === 1 && specs[0] === "No Specialization") {
        const option = document.createElement("option");
        option.value = "No Specialization";
        option.textContent = "No Specialization";
        option.selected = true;
        specializationSelect.appendChild(option);

        
        specializationSelect.classList.add("force-valid");
        } else {
        
        const placeholder = document.createElement("option");
        placeholder.textContent = "Select specialization";
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.value = "";
        specializationSelect.appendChild(placeholder);

        specs.forEach(spec => {
            const option = document.createElement("option");
            option.value = spec;
            option.textContent = spec;
            specializationSelect.appendChild(option);
        });

        specializationSelect.classList.remove("force-valid");
        }

        specializationSelect.dispatchEvent(new Event("change"));
    }
  }
</script>
</body>