<?php
session_start();



// ✔️ Database connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

if (!isset($_SESSION['user_id']) || !isset($_SESSION['first_name'])) {
    header("Location: ../login.php");
    exit();
}
$first_name = $_SESSION['first_name'];

$user_id = $_SESSION['user_id'];
$message = "";

// ✅ Grade calculation function
function calculateGrade($conn, $user_subject_id) {
    $query = "
        SELECT
            SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS total_done,
            COUNT(*) AS total_tasks
        FROM (
            SELECT status FROM activities WHERE user_subject_id = ?
            UNION ALL
            SELECT status FROM quizzes WHERE user_subject_id = ?
            UNION ALL
            SELECT status FROM exams WHERE user_subject_id = ?
        ) AS all_tasks;
    ";

    $stmt = $conn->prepare($query);
    $stmt->bind_param("iii", $user_subject_id, $user_subject_id, $user_subject_id);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $done = (int)$result['total_done'];
    $total = (int)$result['total_tasks'];

    if ($total === 0) return 0;

    return round(($done / $total) * 100, 2);
}

// ✅ Handle subject creation
if ($_SERVER["REQUEST_METHOD"] === "POST" && isset($_POST['add_subject'])) {
    $subject_name = trim($_POST['subject_name']);
    $course_code = trim($_POST['course_code']);
    $trimester = trim($_POST['semester']);
    $year_level = $_POST['year_level'];

    if (!isset($_POST['units'])) {
        $message = "❌ Please select number of units.";
    } else {
        $units = intval($_POST['units']);

        if ($subject_name && $course_code && $trimester && $year_level) {
            $stmt = $conn->prepare("
                INSERT INTO subjects (subject_name, course_code, units, year_level, trimester)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->bind_param("ssiss", $subject_name, $course_code, $units, $year_level, $trimester);
            $stmt->execute();
            $subject_id = $stmt->insert_id;
            $stmt->close();

            $stmt = $conn->prepare("
                INSERT INTO user_subjects (user_id, subject_id)
                VALUES (?, ?)
            ");
            $stmt->bind_param("ii", $user_id, $subject_id);
            $stmt->execute();
            $stmt->close();

            header("Location: mysubjects.php");
            exit();
        } else {
            $message = "❌ All fields are required.";
        }
    }
}

// ✅ Fetch user subjects
$subjects = [];
$stmt = $conn->prepare("
    SELECT us.user_subject_id, s.subject_name, s.course_code, s.trimester,
           s.year_level, s.units
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_id = ?
");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$result = $stmt->get_result();

while ($row = $result->fetch_assoc()) {
    // ✅ Fetch progress
    $progressStmt = $conn->prepare("
        SELECT
            SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS completed,
            COUNT(*) AS total
        FROM (
            SELECT status FROM activities WHERE user_subject_id = ?
            UNION ALL
            SELECT status FROM quizzes WHERE user_subject_id = ?
            UNION ALL
            SELECT status FROM exams WHERE user_subject_id = ?
        ) all_tasks
    ");
    $progressStmt->bind_param("iii", $row['user_subject_id'], $row['user_subject_id'], $row['user_subject_id']);
    $progressStmt->execute();
    $progressResult = $progressStmt->get_result()->fetch_assoc();
    $progressStmt->close();

    $row['total_tasks'] = $progressResult['total'] ?? 0;
    $row['completed_tasks'] = $progressResult['completed'] ?? 0;
    $row['progress_percent'] = ($row['total_tasks'] > 0)
        ? round(($row['completed_tasks'] / $row['total_tasks']) * 100)
        : 0;

    // ✅ Grade
    $row['grade'] = calculateGrade($conn, $row['user_subject_id']);

    $subjects[] = $row;
}
$stmt->close();
?>



<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My Subjects</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
  <style>
  @keyframes gradientFlow {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

 html, body {
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', sans-serif;
  height: 100vh;
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 10s ease infinite;
  color: #333;
  /* REMOVE flex centering */
  display: block;
  overflow-x: hidden;
}

  .small-type {
    font-size: 0.8rem;
    color: #555;
    margin-left: 6px;
  }

  .task-progress-bar {
    height: 8px;
    width: 100%;
    background: #ddd;
    border-radius: 20px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a1c4fd, #c2e9fb);
    transition: width 0.4s ease;
  }

  .task-count {
    font-size: 12px;
    color: #555;
    margin-top: 4px;
  }

  .dashboard-wrapper {
  padding: 32px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding-left: 40px; /* 👈 Add this */
}


  h1 {
  font-size: 4rem;
  margin-bottom: 25px;
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-position: left center;
  animation: gradientFlow 10s ease infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

  .dashboard {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
    overflow-x: auto;
    padding-bottom: 12px;
    padding-left: 8px;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .dashboard::-webkit-scrollbar {
    display: none;
  }

  .subject-card {
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 20px;
    padding: 20px;
    width: 290px;
    flex-shrink: 0;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    justify-content: space-between;
    word-wrap: break-word;
    position: relative;
    overflow: hidden;
    transition: transform 0.3s ease;
  }

  .subject-card:hover {
    transform: scale(1.02);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    font-size: 1.3rem;
    margin-bottom: 16px;
  }

  .grade-ring {
    width: 45px;
    height: 45px;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 600;
    background: conic-gradient(#00bcd4 90%, #e0e0e0 10%);
    color: #004d60;
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .task-item {
    padding: 12px;
    border-radius: 12px;
    background-color: #fff;
    margin-bottom: 10px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
  }

  .task-top span {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .task-top i {
    font-size: 0.9rem;
  }

  .progress-bar {
    margin-top: 5px;
    height: 8px;
    background-color: #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.4s ease;
  }

  .progress-red { background-color: #ef5350; }
  .progress-orange { background-color: #ffa726; }
  .progress-green { background-color: #66bb6a; }

  .urgency-high { background-color: #ef5350; }
  .urgency-medium { background-color: #ffa726; }
  .urgency-low { background-color: #66bb6a; }
  .urgency-pending { background-color: gray; }

  form {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 24px;
  border-radius: 12px;
  margin-bottom: 30px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  max-width: 100%;
}

form {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(16px);
  border: 2px solid transparent;
  border-radius: 16px;
  padding: 30px;
  margin-bottom: 30px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  background-clip: padding-box;
  border-image: linear-gradient(120deg, #f0679d, #74bcd9) 1;
  animation: gradientFlow 10s ease infinite;
}

.form-title {
  font-size: 1.8rem;
  margin-bottom: 20px;
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gradientFlow 10s ease infinite;
}

.form-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

form input,
form select {
  flex: 1 1 240px;
  padding: 12px 16px;
  font-size: 1rem;
  border-radius: 10px;
  border: 1px solid #ccc;
  background-color: rgba(255, 255, 255, 0.85);
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);
  transition: border 0.3s ease, box-shadow 0.3s ease;
}

form input:focus,
form select:focus {
  outline: none;
  border-color: #74bcd9;
  box-shadow: 0 0 0 3px rgba(116, 188, 217, 0.3);
}

form button {
  padding: 12px 28px;
  font-size: 1rem;
  font-weight: bold;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  background: linear-gradient(90deg, #f0679d, #74bcd9);
  background-size: 200% auto;
  color: white;
  animation: gradientFlow 10s ease infinite;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

form button:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(116, 188, 217, 0.35);
}

.title-with-home {
  display: flex;
  align-items: center;
  gap: 12px;
}

.home-btn {
  margin-left: auto;
  background: transparent; /* Make button blend with background */
  border: none;
  border-radius: 12px;
  padding: 6px 10px;
  font-size: 1rem;
  cursor: pointer;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.08));
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  transform: translateY(18px); /* or remove this */
}

.home-btn i {
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-position: left center;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 2rem;
}

  #toggleFormBtn{
    margin-bottom: 20px;
    margin-left: 10px;
    padding: 10px 16px;
    background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
    background-size: 200% auto;
    background-position: left center;
    animation: gradientFlow 10s ease infinite;
    border: none;
    color: white;
    border-radius: 8px;
    cursor: pointer;
    font-weight: bold;
    transition: transform 0.2s ease, box-shadow 0.2s ease;

    }



  .small-text {
    font-size: 0.9rem;
    color: darkgreen;
  }

  .unit-toggle {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }

  .unit-toggle input[type="radio"] {
    display: none;
  }

  .no-task-msg {
  background-color: #ffcde1; /* light pink */
  color: #800040;
  font-weight: 600;
  text-align: center;
  padding: 14px;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}


  .unit-toggle label {
    padding: 8px 16px;
    border: 2px solid #ccc;
    border-radius: 8px;
    cursor: pointer;
    background-color: #f0f0f0;
    transition: all 0.2s ease-in-out;
  }

  .unit-toggle input[type="radio"]:checked + label {
    background-color: #a6d8ff;
    border-color: #3399ff;
  }

  @media (max-width: 768px) {
    .dashboard-wrapper {
      padding: 20px;
    }
  }
</style>

</head>
<body>
<div class="dashboard-wrapper">
  <div class="title-with-home">
  <h1>📘My Subjects</h1>
      <button class="home-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/dashboard/dashboard.php'">
        <i class="fa-solid fa-house"></i>
   </button>
</div>
    
  <!-- Toggle Add Subject Form -->
  <button id="toggleFormBtn">Add New Subject</button>

  <!-- Add Subject Form -->
  <form method="POST" action="" id="subjectForm" style="display: none;">
    <h3 class="form-title">📘 Add New Subject</h3>

    <div class="form-row">
      <input type="text" name="course_code" placeholder="Course Code" required />
      <input type="text" name="subject_name" placeholder="Subject Name" required />
    </div>

    <div class="form-row">
      <select name="year_level" required>
        <option value="">Year Level</option>
        <option value="1st Year">1st Year</option>
        <option value="2nd Year">2nd Year</option>
        <option value="3rd Year">3rd Year</option>
        <option value="4th Year">4th Year</option>
      </select>

      <select name="term" required>
        <option value="">Select Term</option>
        <option value="1st Term">1st Term</option>
        <option value="2nd Term">2nd Term</option>
        <option value="3rd Term">3rd Term</option>
      </select>
    </div>

    <div class="form-row">
      <select name="semester" required>
        <option value="">Select Trimester</option>
        <option value="1st Trimester">1st Trimester</option>
        <option value="2nd Trimester">2nd Trimester</option>
        <option value="3rd Trimester">3rd Trimester</option>
      </select>

      <select name="units" required>
        <option value="">Select Units</option>
        <?php for ($i = 0; $i <= 3; $i++): ?>
          <option value="<?= $i ?>"><?= $i ?> Unit<?= $i !== 1 ? 's' : '' ?></option>
        <?php endfor; ?>
      </select>
    </div>

    <button type="submit" name="add_subject">Submit</button>

    <?php if (!empty($message)): ?>
      <div class="small-text" style="margin-top: 10px;"><?= htmlspecialchars($message) ?></div>
    <?php endif; ?>
  </form>

  <!-- Subject Dashboard Cards -->
  <div class="dashboard">
  <?php foreach ($subjects as $sub): ?>
    <div class="subject-card" data-id="<?= htmlspecialchars($sub['user_subject_id']) ?>">
      <div class="card-header">
        <div style="flex: 1;">
          <div style="font-size: 1.3rem; font-weight: 600;">
            <?= htmlspecialchars($sub['course_code']) ?>
          </div>
          <div style="font-size: 0.95rem; font-weight: 500; color: #333; margin-top: 4px; line-height: 1.3;">
            <?= htmlspecialchars($sub['subject_name']) ?>
          </div>
          <div style="font-size: 0.85rem; font-weight: 500; color: #333; margin-top: 4px;">
            <?= htmlspecialchars($sub['trimester']) ?>
          </div>
        </div>
        <div class="grade-ring"><?= htmlspecialchars($sub['grade']) ?>%</div>
      </div>
    </div>
  <?php endforeach; ?>
</div>

<script>
  // Toggle the add subject form
  document.getElementById("toggleFormBtn").addEventListener("click", function () {
    const form = document.getElementById("subjectForm");
    form.style.display = (form.style.display === "none" || form.style.display === "") ? "block" : "none";
  });

  // Hide message after a few seconds
  const message = document.querySelector('.small-text');
  if (message) {
    setTimeout(() => message.style.display = 'none', 3000);
  }

  // Click / Right-click handlers
  document.querySelectorAll('.subject-card').forEach(card => {
    // Left-click: View subject
    card.addEventListener('click', function (e) {
      if (e.button === 0) {
        const userSubjectId = this.getAttribute('data-id');
        window.location.href = `subjectcard.php?id=${userSubjectId}`;
      }
    });

    // Right-click: Delete
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();

      if (confirm("❗ Are you sure you want to delete this subject?")) {
        const userSubjectId = this.getAttribute('data-id');
        const cardElement = this;

        fetch('remove_subject.php', {
          method: 'POST',
          body: new URLSearchParams({ user_subject_id: userSubjectId })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success') {
            alert("✅ Subject deleted successfully!");
            cardElement.remove();
          } else {
            alert("❌ Failed to delete. Server responded:\n" + JSON.stringify(data));
          }
        })
        .catch(err => alert("Request error: " + err));
      }
    });
  });
</script>

<!-- Right-click Context Menu -->
<div id="customContextMenu" style="display:none; position:absolute; background:white; border:1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index:1000; padding: 8px; border-radius: 6px;">
  <div id="deleteOption" style="cursor:pointer; padding: 5px 10px;">🗑️ Delete Subject</div>
</div>

<!-- Confirmation Modal -->
<div id="confirmModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); z-index:1001; align-items:center; justify-content:center;">
  <div style="background:white; padding:20px 30px; border-radius:8px; text-align:center; max-width:300px; margin:auto;">
    <p style="margin-bottom: 1rem;">❗Are you sure you want to delete this subject?</p>
    <button id="confirmYes" style="margin-right:10px;">Yes</button>
    <button id="confirmNo">No</button>
  </div>
</div>
</body>


</html>
