<?php
ob_start();
session_start();

if (!isset($_SESSION['user_id']) || !isset($_SESSION['first_name'])) {
    header("Location: ../login.php");
    exit();
}
$first_name = $_SESSION['first_name'];

// ✅ DB Connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

$user_id = $_SESSION['user_id'];
$user_subject_id = isset($_GET['id']) ? intval($_GET['id']) : 0;
if ($user_subject_id <= 0) {
    die("Invalid subject ID.");
}

// 📌 Auto Mode Handling
if (isset($_GET['auto_mode'])) {
    $_SESSION['auto_mode'] = $_GET['auto_mode'];
}
$auto_mode = $_SESSION['auto_mode'] ?? 'final'; // default to final

if ($auto_mode === "midterm") {
    $weights = [
        'Activities' => 24,
        'Quizzes' => 36,
        'Midterm' => 40,
        'Final Exam' => 0
    ];
} elseif ($auto_mode === "final") {
    $weights = [
        'Activities' => 24,
        'Quizzes' => 36,
        'Midterm' => 15,
        'Final Exam' => 25
    ];
} else {
    $stmt = $conn->prepare("
        SELECT activities_weight, quizzes_weight, midterm_weight, final_weight
        FROM grade_settings
        WHERE user_subject_id = ?
    ");
    $stmt->bind_param("i", $user_subject_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $gradeSettings = $result->fetch_assoc() ?? [
        'activities_weight' => 0,
        'quizzes_weight' => 0,
        'midterm_weight' => 0,
        'final_weight' => 0
    ];
    $weights = [
        'Activities' => $gradeSettings['activities_weight'],
        'Quizzes' => $gradeSettings['quizzes_weight'],
        'Midterm' => $gradeSettings['midterm_weight'],
        'Final Exam' => $gradeSettings['final_weight']
    ];
}

// 🛠️ Update grade entry (handled synchronously — not ideal for AJAX)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['update_grade'])) {
    $type = $_POST['type'];
    $id = intval($_POST['id']);
    $grade = floatval($_POST['grade']);

    switch ($type) {
        case 'activities':
            $stmt = $conn->prepare("UPDATE activities SET grade = ? WHERE activity_id = ?");
            break;
        case 'quizzes':
            $stmt = $conn->prepare("UPDATE quizzes SET grade = ? WHERE quiz_id = ?");
            break;
        case 'exams':
            $stmt = $conn->prepare("UPDATE exams SET grade = ? WHERE exam_id = ?");
            break;
        default:
            die("Invalid type.");
    }

    if ($stmt) {
        $stmt->bind_param("di", $grade, $id);
        $stmt->execute();
    }
}

// ➕ Add or update entry (⚠️ This part should ideally move to save_entry.php for clean AJAX interaction)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_entry'])) {
    $type = $_POST['type'] ?? '';
    $name = trim($_POST['name'] ?? '');
    $specific_type = trim($_POST['specific_type'] ?? '');
    $urgency = $_POST['urgency'] ?? '';
    $status = $_POST['status'] ?? '';
    $deadline = $_POST['deadline'] ?? null;

    $entry_id = isset($_POST['entry_id']) ? intval($_POST['entry_id']) : 0;

$score = isset($_POST['score']) && $_POST['score'] !== '' ? floatval($_POST['score']) : null;
$items = isset($_POST['items']) && $_POST['items'] !== '' ? floatval($_POST['items']) : null;

$grade = null;
if ($score !== null && $items !== null && $items > 0) {
    $grade = ($score / $items) * 100;
}

    // ✅ Validate required fields
    if (!$type || !$name || !$deadline || $deadline === '0000-00-00' || !$user_subject_id) {
        echo "❌ Missing or invalid data.";
        exit();
    }

    switch ($type) {
        case 'activities':
            if ($entry_id > 0) {
                $stmt = $conn->prepare("
                    UPDATE activities SET
                        activity_name = ?, activity_type = ?, urgency = ?, status = ?, deadline = ?, score = ?, items = ?, grade = ?
                    WHERE activity_id = ?
                ");
                $stmt->bind_param("ssssssddi",
                    $name, $specific_type, $urgency, $status, $deadline, $score, $items, $grade, $entry_id
                );
            } else {
                $stmt = $conn->prepare("
                    INSERT INTO activities (
                        user_subject_id, activity_name, activity_type,
                        urgency, status, deadline, score, items, grade
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->bind_param("isssssddd",
                    $user_subject_id, $name, $specific_type,
                    $urgency, $status, $deadline, $score, $items, $grade
                );
            }
            break;

        case 'quizzes':
            if ($entry_id > 0) {
                $stmt = $conn->prepare("
                    UPDATE quizzes SET
                        quiz_name = ?, urgency = ?, status = ?, deadline = ?, score = ?, items = ?, grade = ?
                    WHERE quiz_id = ?
                ");
                $stmt->bind_param("ssssdddi", $name, $urgency, $status, $deadline, $score, $items, $grade, $entry_id);
            } else {
                $stmt_temp = $conn->prepare("SELECT MAX(quiz_number) AS max_quiz FROM quizzes WHERE user_subject_id = ?");
                $stmt_temp->bind_param("i", $user_subject_id);
                $stmt_temp->execute();
                $result = $stmt_temp->get_result();
                $row = $result->fetch_assoc();
                $quiz_number = ($row['max_quiz'] ?? 0) + 1;
                $stmt_temp->close();

                $stmt = $conn->prepare("
                    INSERT INTO quizzes (
                        user_subject_id, quiz_name, quiz_number,
                        urgency, status, deadline, score, items, grade
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->bind_param("isisssddd",
                    $user_subject_id, $name, $quiz_number,
                    $urgency, $status, $deadline, $score, $items, $grade
                );
            }
            break;

        case 'exams':
            if ($entry_id > 0) {
                $stmt = $conn->prepare("
                    UPDATE exams SET
                        exam_name = ?, exam_type = ?, urgency = ?, status = ?, deadline = ?, score = ?, items = ?, grade = ?
                    WHERE exam_id = ?
                ");
                $stmt->bind_param("ssssssddi", $name, $specific_type, $urgency, $status, $deadline, $score, $items, $grade, $entry_id);
            } else {
                $stmt = $conn->prepare("
                    INSERT INTO exams (
                        user_subject_id, exam_name, exam_type,
                        urgency, status, deadline, score, items, grade
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->bind_param("isssssddd",
                    $user_subject_id, $name, $specific_type,
                    $urgency, $status, $deadline, $score, $items, $grade
                );
            }
            break;

        default:
            die("Invalid type");
    }

    if ($stmt && $stmt->execute()) {
        $stmt->close();
        header("Location: " . $_SERVER['PHP_SELF'] . "?id=$user_subject_id");
        exit();
    } else {
        echo "❌ Error: " . $conn->error;
    }
}

// ✅ Fetch subject info
$stmt = $conn->prepare("
    SELECT s.subject_name, s.course_code, s.units, s.year_level, s.trimester
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_subject_id = ? AND us.user_id = ?
");
$stmt->bind_param("ii", $user_subject_id, $user_id);
$stmt->execute();
$result = $stmt->get_result();
if ($result->num_rows === 0) {
    echo "Subject not found.";
    exit();
}
$subject = $result->fetch_assoc();

// 🔍 Fetch Activities
$stmt = $conn->prepare("
    SELECT activity_id AS id, activity_name AS name, activity_type AS type,
           urgency, status, deadline, score, items, grade
    FROM activities
    WHERE user_subject_id = ?
");
$stmt->bind_param("i", $user_subject_id);
$stmt->execute();
$tasks = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// 🔍 Fetch Quizzes
$stmt = $conn->prepare("
    SELECT quiz_id AS id, quiz_name AS name, quiz_number AS type,
           urgency, status, deadline, score, items, grade
    FROM quizzes
    WHERE user_subject_id = ?
");
$stmt->bind_param("i", $user_subject_id);
$stmt->execute();
$quizzes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// 🔍 Fetch Exams
$stmt = $conn->prepare("
    SELECT exam_id AS id, exam_name AS name, exam_type AS type,
           urgency, status, deadline, score, items, grade
    FROM exams
    WHERE user_subject_id = ?
");
$stmt->bind_param("i", $user_subject_id);
$stmt->execute();
$exams = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// ✅ Send user_subject_id to JavaScript
?>
<script>
    const userSubjectId = <?= $user_subject_id ?>;
</script>
<?php
ob_end_flush();
?>







<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><?= htmlspecialchars($subject['subject_name']) ?> – Subject Card</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
<style>
  @keyframes gradientFlow {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  body {
    margin: 0;
    font-family: 'Segoe UI', sans-serif;
    background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
    background-size: 300% 300%;
    animation: gradientFlow 12s ease infinite;
    padding: 40px;
    color: #333;
  }

  h1 {
    margin-bottom: 10px;
    font-size: 2.0rem;
      font-weight: 700;
      background: linear-gradient(to right, #4dabf5, #ec407a);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 12px;
  }

  h2 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 1.3rem;
    margin-bottom: 12px;
  }

  h2 button {
    margin-left: auto;
  }

  .glass-card {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 1rem;
  color: white;
}

.mode-dropdown {
  width: auto; /* shrink-to-fit */
  padding: 4px 12px;  /* tighter padding */
  font-size: 0.85em;  /* slightly smaller font */
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  padding-right: 24px; /* Room for dropdown arrow */
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23333'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px;
}
  .card {
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-radius: 20px;
    padding: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    margin-bottom: 30px;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    overflow: hidden;
  }

  th, td {
    padding: 8px 10px;
    text-align: left;
    border: 1px solid #ccc;
    font-size: 0.9rem;
    vertical-align: middle;
  }

  th {
    background-color: rgba(227, 242, 253, 0.9);
  }

  tr:nth-child(even) {
    background-color: rgba(248, 249, 250, 0.85);
  }

  input, select {
    width: 100%;
    padding: 5px 6px;
    font-size: 0.9em;
    box-sizing: border-box;
    border-radius: 6px;
    border: 1px solid #ccc;
    background-color: #fff;
  }

  select.input-cell {
    height: 34px;
  }

  /* Individual column widths */
  th:nth-child(1), td:nth-child(1) { width: 180px; }  /* Name */
  th:nth-child(2), td:nth-child(2) { width: 180px; }  /* Type (wider) */
  th:nth-child(3), td:nth-child(3) { width: 110px; }  /* Urgency */
  th:nth-child(4), td:nth-child(4) { width: 110px; }  /* Status (wider) */
  th:nth-child(5), td:nth-child(5) { width: 140px; }  /* Deadline (wider) */
  th:nth-child(6), td:nth-child(6) { width: 60px; text-align: center; } /* Score */
  th:nth-child(7), td:nth-child(7) { width: 60px; text-align: center; } /* Items */
  th:nth-child(8), td:nth-child(8) { width: 40px; text-align: center; } /* Grade (narrower) */
  th:nth-child(9), td:nth-child(9) {
    width: 140px;
    text-align: center;
    white-space: nowrap;
  }

  td.grade-output {
    background-color: #eaf6ea;
    font-weight: bold;
    color: #2e7d32;
    border-radius: 10px;
    padding: 2px 8px;
    text-align: center;
    min-width: 40px;
  }

.save-btn {
  background-color: #5cb85c;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85em;
  cursor: pointer;
}

.save-btn:hover {
  background-color: #4cae4c;
}

.delete-btn {
  background-color: #d9534f;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85em;
  cursor: pointer;
  margin-left: 6px;
}

.delete-btn:hover {
  background-color: #c9302c;
}


  table tr.form-row td {
    background-color: rgba(255, 255, 255, 0.85);
    border: 1px solid #ccc;
    padding: 8px 10px;
  }

  /* Input alignment */
  .input-cell, select.input-cell {
    width: 100%;
    height: 32px;
    font-size: 0.9em;
    box-sizing: border-box;
    border-radius: 6px;
    padding: 6px 8px;
  }

  td input[type="number"] {
    text-align: center;
  }

  .add-btn {
    background-color: pink;
    border: none;
    padding: 6px 14px;
    border-radius: 999px;
    font-weight: bold;
    cursor: pointer;
    font-size: 0.9em;
    transition: background 0.3s ease;
  }

  .add-btn:hover {
    background-color: #f8a7c6;
  }

      .title-with-home {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-with-home h1 {
  margin-bottom: 0;
}

.home-btn {
  margin-left: auto;
  border: none;
  border-radius: 12px;
  padding: 6px 10px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s ease;
  background: #fff;
  border-color: #4dabf5;                 /* highlight border */
  box-shadow: 0 4px 12px rgba(77, 171, 245, 0.3); /* optional glow */
  display: flex;
  align-items: center;
  justify-content: center;
  transform:translateY(15px);
  
}

.home-btn i {
  background: linear-gradient(to right, #4dabf5, #ec407a);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
  font-size: 1.5rem;
}


</style>

</head>
<body>
<!-- 🔖 Subject Header -->
<div class="card">
  <div class="title-with-home">
      <h1> <?= htmlspecialchars($subject['subject_name']) ?> (<?= htmlspecialchars($subject['course_code']) ?>)</h1>
      <button class="home-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/studypulse/mysubjects.php'">
        <i class="fa-solid fa-house"></i>
      </button>
    </div>
  <p>
    <strong>Units:</strong> <?= $subject['units'] ?><br>
    <strong>Year Level:</strong> <?= $subject['year_level'] ?><br>
    <strong>Trimester:</strong> <?= isset($subject['trimester']) ? htmlspecialchars($subject['trimester']) : 'N/A' ?>
  </p>
</div>

<!-- 🔹 ACTIVITIES -->
<div class="card">
  <h2>✍️ Activities <button class="add-btn" onclick="addRow('activities')">+ Add</button></h2>
  <table id="activities-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Urgency</th>
        <th>Status</th>
        <th>Deadline</th>
        <th>Score</th>
        <th>Items</th>
        <th>Grade</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($tasks as $task): ?>
        <tr data-user-subject-id="<?= htmlspecialchars($user_subject_id) ?>">
          <td><input type="text" class="input-cell" name="name" value="<?= htmlspecialchars($task['name']) ?>"></td>
          <td>
            <select class="input-cell" name="specific_type">
              <?php
              $activityTypes = ['Seatwork', 'Performance Task', 'Take-Home Activity', 'Laboratory Activity', 'Technical Assessment'];
              foreach ($activityTypes as $typeOption):
              ?>
                <option <?= $task['type'] === $typeOption ? 'selected' : '' ?>><?= $typeOption ?></option>
              <?php endforeach; ?>
            </select>
          </td>
          <td>
            <select class="input-cell" name="urgency">
              <option <?= $task['urgency'] === 'Low' ? 'selected' : '' ?>>Low</option>
              <option <?= $task['urgency'] === 'Medium' ? 'selected' : '' ?>>Medium</option>
              <option <?= $task['urgency'] === 'High' ? 'selected' : '' ?>>High</option>
            </select>
          </td>
          <td>
            <select class="input-cell" name="status">
              <option <?= $task['status'] === 'Pending' ? 'selected' : '' ?>>Pending</option>
              <option <?= $task['status'] === 'Done' ? 'selected' : '' ?>>Done</option>
            </select>
          </td>
          <td><input type="date" class="input-cell" name="deadline" value="<?= htmlspecialchars($task['deadline']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell score" name="score" value="<?= htmlspecialchars($task['score']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell items" name="items" value="<?= htmlspecialchars($task['items']) ?>"></td>
          <td class="grade-output"><?= htmlspecialchars($task['grade']) ?></td>
          <td style="white-space: nowrap;">
            <button class="save-btn" type="button">Save</button>
            <button class="delete-btn" type="button" onclick="deleteRow(this)">Delete</button>
            <input type="hidden" name="entry_id" value="<?= htmlspecialchars($task['id']) ?>">
            <input type="hidden" name="type" value="activities">
            <input type="hidden" name="user_subject_id" value="<?= $user_subject_id ?>">
          </td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>

<!-- 🗒 QUIZZES -->
<div class="card">
  <h2>📖 Quizzes <button class="add-btn" onclick="addRow('quizzes')">+ Add</button></h2>
  <table id="quizzes-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Quiz Number</th>
        <th>Urgency</th>
        <th>Status</th>
        <th>Deadline</th>
        <th>Score</th>
        <th>Items</th>
        <th>Grade</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($quizzes as $index => $quiz): ?>
        <tr data-user-subject-id="<?= htmlspecialchars($user_subject_id) ?>">
          <td><input type="text" class="input-cell" name="name" value="<?= htmlspecialchars($quiz['name']) ?>"></td>
          <td class="quiz-number"><?= $index + 1 ?></td>
          <td>
            <select class="input-cell" name="urgency">
              <option <?= $quiz['urgency'] === 'Low' ? 'selected' : '' ?>>Low</option>
              <option <?= $quiz['urgency'] === 'Medium' ? 'selected' : '' ?>>Medium</option>
              <option <?= $quiz['urgency'] === 'High' ? 'selected' : '' ?>>High</option>
            </select>
          </td>
          <td>
            <select class="input-cell" name="status">
              <option <?= $quiz['status'] === 'Pending' ? 'selected' : '' ?>>Pending</option>
              <option <?= $quiz['status'] === 'Done' ? 'selected' : '' ?>>Done</option>
            </select>
          </td>
          <td><input type="date" class="input-cell" name="deadline" value="<?= htmlspecialchars($quiz['deadline']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell score" name="score" value="<?= htmlspecialchars($quiz['score']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell items" name="items" value="<?= htmlspecialchars($quiz['items']) ?>"></td>
          <td class="grade-output"><?= htmlspecialchars($quiz['grade']) ?></td>
          <td style="white-space: nowrap;">
            <button class="save-btn" type="button">Save</button>
            <button class="delete-btn" type="button" onclick="deleteRow(this)">Delete</button>
            <input type="hidden" name="entry_id" value="<?= htmlspecialchars($quiz['id']) ?>">
            <input type="hidden" name="type" value="quizzes">
            <input type="hidden" name="user_subject_id" value="<?= $user_subject_id ?>">
          </td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>

<!-- EXAMS -->
<div class="card">
  <h2>📚 Exams <button class="add-btn" onclick="addRow('exams')">+ Add</button></h2>
  <table id="exams-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Urgency</th>
        <th>Status</th>
        <th>Deadline</th>
        <th>Score</th>
        <th>Items</th>
        <th>Grade</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($exams as $exam): ?>
        <tr data-user-subject-id="<?= htmlspecialchars($user_subject_id) ?>">
          <td><input type="text" class="input-cell" name="name" value="<?= htmlspecialchars($exam['name']) ?>"></td>
          <td>
            <select class="input-cell" name="specific_type">
              <?php
              $examTypes = ['Midterm', 'Final Exam'];
              foreach ($examTypes as $typeOption):
              ?>
                <option <?= $exam['type'] === $typeOption ? 'selected' : '' ?>><?= $typeOption ?></option>
              <?php endforeach; ?>
            </select>
          </td>
          <td>
            <select class="input-cell" name="urgency">
              <option <?= $exam['urgency'] === 'Low' ? 'selected' : '' ?>>Low</option>
              <option <?= $exam['urgency'] === 'Medium' ? 'selected' : '' ?>>Medium</option>
              <option <?= $exam['urgency'] === 'High' ? 'selected' : '' ?>>High</option>
            </select>
          </td>
          <td>
            <select class="input-cell" name="status">
              <option <?= $exam['status'] === 'Pending' ? 'selected' : '' ?>>Pending</option>
              <option <?= $exam['status'] === 'Done' ? 'selected' : '' ?>>Done</option>
            </select>
          </td>
          <td><input type="date" class="input-cell" name="deadline" value="<?= htmlspecialchars($exam['deadline']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell score" name="score" value="<?= htmlspecialchars($exam['score']) ?>"></td>
          <td><input type="number" step="0.01" class="input-cell items" name="items" value="<?= htmlspecialchars($exam['items']) ?>"></td>
          <td class="grade-output"><?= htmlspecialchars($exam['grade']) ?></td>
          <td style="white-space: nowrap;">
            <button class="save-btn" type="button">Save</button>
            <button class="delete-btn" type="button" onclick="deleteRow(this)">Delete</button>
            <input type="hidden" name="entry_id" value="<?= htmlspecialchars($exam['id']) ?>">
            <input type="hidden" name="type" value="exams">
            <input type="hidden" name="user_subject_id" value="<?= $user_subject_id ?>">
          </td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>


<!-- 🎯 GRADE CALCULATOR -->
<div class="card">
  <h2>
    📊 Grade Calculator
    <select id="grade-mode" class="add-btn mode-dropdown" onchange="toggleGradeMode(this.value)">
      <option value="finals">Finals</option>
      <option value="midterm">Midterm</option>
      <option value="manual">What-If?</option>
    </select>
  </h2>

  <table>
    <thead>
      <tr>
        <th>Component</th>
        <th>Weight (%)</th>
        <th>Your Grade</th>
        <th>Weighted Score</th>
      </tr>
    </thead>
    <tbody>
      <?php
        function computeAverage($entries) {
          $total = 0;
          $count = 0;
          foreach ($entries as $entry) {
            if (isset($entry['grade'])) {
              $total += floatval($entry['grade']);
              $count++;
            }
          }
          return $count > 0 ? $total / $count : 0;
        }

        function computeExamAverage($exams, $type) {
          $total = 0;
          $count = 0;
          foreach ($exams as $exam) {
            if (isset($exam['grade']) && $exam['type'] === $type) {
              $total += floatval($exam['grade']);
              $count++;
            }
          }
          return $count > 0 ? $total / $count : 0;
        }

        $activitiesAvg = round(computeAverage($tasks), 2);
        $quizzesAvg = round(computeAverage($quizzes), 2);

        $midtermAvg = round(computeExamAverage($exams, 'Midterm'), 2);
        $finalExamAvg = round(computeExamAverage($exams, 'Final Exam'), 2);
        $examFinalsAvg = $midtermAvg * 0.375 + $finalExamAvg * 0.625; // 15/40 and 25/40

        $autoModes = [
          'midterm' => [
            'Activities' => ['weight' => 24, 'grade' => $activitiesAvg],
            'Quizzes' => ['weight' => 36, 'grade' => $quizzesAvg],
            'Exams' => ['weight' => 40, 'grade' => $midtermAvg],
          ],
          'finals' => [
            'Activities' => ['weight' => 24, 'grade' => $activitiesAvg],
            'Quizzes' => ['weight' => 36, 'grade' => $quizzesAvg],
            'Exams' => ['weight' => 40, 'grade' => $examFinalsAvg],
          ]
        ];
      ?>

      <?php foreach (['Activities', 'Quizzes', 'Exams'] as $component): ?>
        <tr>
          <td><?= $component ?></td>
          <td>
            <input
              type="number"
              class="input-cell weight-input"
              data-component="<?= $component ?>"
              value="<?= $autoModes['finals'][$component]['weight'] ?>"
              min="0" max="100" step="0.01"
            >
          </td>
          <td>
            <input
              type="number"
              class="input-cell grade-input"
              data-component="<?= $component ?>"
              value="<?= $autoModes['finals'][$component]['grade'] ?>"
              min="0" max="100" step="0.01"
            >
          </td>
          <td class="grade-output weighted-score">0.00</td>
        </tr>
      <?php endforeach; ?>

      <tr>
        <td colspan="3" style="text-align: right;"><strong>Total Grade:</strong></td>
        <td id="total-grade" class="grade-output">0.00</td>
      </tr>
    </tbody>
  </table>
</div> 




<script>
function addRow(type) {
  const tableId = `${type}-table`;
  const tbody = document.getElementById(tableId).querySelector('tbody');
  const quizNumber = type === 'quizzes' ? tbody.querySelectorAll('tr').length + 1 : '-';

  // ✅ Use global JS variable set in PHP
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="input-cell" name="name" required></td>
    ${
      type === 'activities'
        ? `<td>
            <select class="input-cell" name="specific_type">
              <option value="Seatwork">Seatwork</option>
              <option value="Performance Task">Performance Task</option>
              <option value="Take-Home Activity">Take-Home Activity</option>
              <option value="Laboratory Activity">Laboratory Activity</option>
              <option value="Technical Assessment">Technical Assessment</option>
            </select>
          </td>`
        : type === 'exams'
        ? `<td>
            <select class="input-cell" name="specific_type">
              <option value="Midterm">Midterm</option>
              <option value="Final Exam">Final Exam</option>
            </select>
          </td>`
        : `<td class="quiz-number">${quizNumber}</td>`
    }
    <td>
      <select class="input-cell" name="urgency">
        <option>High</option>
        <option>Medium</option>
        <option>Low</option>
      </select>
    </td>
    <td>
      <select class="input-cell" name="status">
        <option>Pending</option>
        <option>Done</option>
      </select>
    </td>
    <td><input class="input-cell" type="date" name="deadline" required></td>
    <td><input class="input-cell score" type="number" step="0.01" min="0" name="score"></td>
    <td><input class="input-cell items" type="number" step="0.01" min="0.01" name="items" required></td>
    <td class="grade-output">0.00</td>
    <td style="white-space: nowrap;">
      <button class="save-btn" type="button">Save</button>
      <button class="delete-btn" type="button" onclick="deleteRow(this)">Delete</button>
      <input type="hidden" name="type" value="${type}">
      <input type="hidden" name="entry_id" value="">
      <input type="hidden" name="user_subject_id" value="${userSubjectId}">
    </td>
  `;
  tbody.appendChild(tr);

  tr.querySelector('.save-btn').addEventListener('click', () => saveRow(tr.querySelector('.save-btn')));

  tr.querySelectorAll('.score, .items').forEach(input => {
    input.addEventListener('input', () => updateGrade(input));
  });
}


function saveRow(button) {
  const row = button.closest('tr');
  const formData = new FormData();

  row.querySelectorAll('input, select').forEach(input => {
    if (input.name) formData.append(input.name, input.value.trim());
  });

  const scoreVal = row.querySelector('.score')?.value?.trim();
  const itemsVal = row.querySelector('.items')?.value?.trim();

  const score = parseFloat(scoreVal);
  const items = parseFloat(itemsVal);
  let grade = null;

  // Grade calculation logic
  if (!scoreVal && itemsVal) {
    // Only items is given, score is missing
    grade = null;
  } else if (scoreVal && (!itemsVal || isNaN(items) || items <= 0)) {
    // Score is given but items is invalid
    alert("If you enter a score, items must be a number greater than 0.");
    return;
  } else if (!scoreVal && !itemsVal) {
    // Both score and items are missing
    grade = null;
  } else if (!isNaN(score) && !isNaN(items) && items > 0) {
    // Both score and items are valid
    grade = (score / items) * 100;
  }

  // Set formatted grade or blank
  formData.set("grade", grade !== null ? grade.toFixed(2) : "");
  formData.set("add_entry", "1");

  // Basic validations
  const name = formData.get('name');
  const deadline = formData.get('deadline');
  const type = formData.get('type');
  const userSubjectId = formData.get('user_subject_id');

  if (!userSubjectId || userSubjectId === '0') return alert("Invalid subject ID.");
  if (!name) return alert("Please enter a name.");
  if (!deadline || deadline === '0000-00-00') return alert("Please enter a valid deadline.");
  if (!type) return alert("Missing type.");

  // Update UI grade output
  row.querySelector('.grade-output').textContent = grade !== null ? grade.toFixed(2) : "N/A";

  // Save to server
  fetch("save_entry.php", {
    method: "POST",
    body: formData
  })
    .then(async res => {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!res.ok || json.status !== 'success') {
          throw new Error(json.message || 'Save failed');
        }
        return json;
      } catch (err) {
        console.error("JSON error or bad response:", text);
        throw new Error("Invalid server response.");
      }
    })
    .then(result => {
      // Update entry ID from response
      row.querySelector('input[name="entry_id"]').value = result.entry_id;
      row.querySelector('.grade-output').textContent = grade !== null ? grade.toFixed(2) : "N/A";

      updateGradeInputs();
      calculateDynamicGrades();

      // Lock the inputs
      row.querySelectorAll('input, select').forEach(el => {
        if (el.type !== 'hidden') {
          el.readOnly = true;
          el.disabled = true;
        }
      });

      // Feedback
      button.disabled = true;
      button.textContent = "Saved";
      alert("Saved successfully!");
    })
    .catch(err => {
      console.error("Save failed:", err);
      alert("Save failed: " + err.message);
    });
}



function updateGrade(input) {
  const row = input.closest('tr');
  const scoreVal = row.querySelector('.score')?.value.trim();
  const itemsVal = row.querySelector('.items')?.value.trim();

  const hasScore = scoreVal !== "";
  const hasItems = itemsVal !== "";
  const score = parseFloat(scoreVal);
  const items = parseFloat(itemsVal);

  let grade = "";

  if (hasScore && hasItems && !isNaN(score) && !isNaN(items) && items > 0) {
    grade = ((score / items) * 100).toFixed(2);
  }

  row.querySelector('.grade-output').textContent = grade !== null ? grade.toFixed(2) : "N/A";
formData.set("grade", grade !== null ? grade.toFixed(2) : "");


  updateGradeInputs();
  calculateDynamicGrades();
}


function deleteRow(button) {
  const row = button.closest('tr');
  const entryId = row.querySelector('input[name="entry_id"]').value;
  const type = row.querySelector('input[name="type"]').value;

  if (!entryId) {
    row.remove();
    updateGradeInputs();
    calculateDynamicGrades();
    return;
  }

  if (!confirm("Are you sure you want to delete this entry?")) return;

  fetch("delete_entry.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `entry_id=${encodeURIComponent(entryId)}&type=${encodeURIComponent(type)}`
  })
  .then(res => res.text())
  .then(response => {
    alert("Deleted successfully.");
    row.remove();
    updateGradeInputs();
    calculateDynamicGrades();
  })
  .catch(err => {
    console.error("Delete failed:", err);
    alert("Error deleting entry.");
  });
}

function updateGradeInputs() {
  const categoryMap = {
    'Activities': '#activities-table',
    'Quizzes': '#quizzes-table',
    'Exams': '#exams-table'
  };

  Object.entries(categoryMap).forEach(([label, selector]) => {
    const rows = document.querySelectorAll(`${selector} tbody tr`);
    let totalScore = 0, totalItems = 0;

    rows.forEach(row => {
      const scoreVal = row.querySelector('.score')?.value.trim();
      const itemsVal = row.querySelector('.items')?.value.trim();

      const score = parseFloat(scoreVal);
const items = parseFloat(itemsVal);

if (
  !scoreVal && itemsVal || // items given, no score → skip
  !scoreVal && !itemsVal || // both empty → skip
  isNaN(score) || isNaN(items) || items <= 0
) return;
      totalScore += score;
      totalItems += items;
    });

    const average = totalItems > 0 ? (totalScore / totalItems) * 100 : 0;

    document.querySelectorAll('.grade-input').forEach(input => {
      const component = input.closest('tr').cells[0].textContent.trim();
      if (component === label) {
        input.value = average.toFixed(2);
      }
    });
  });
}


function calculateDynamicGrades() {
  let total = 0;
  document.querySelectorAll('tbody tr').forEach(row => {
    const gradeInput = row.querySelector('.grade-input');
    const weightInput = row.querySelector('.weight-input');
    const weightedCell = row.querySelector('.weighted-score');

    if (!gradeInput || !weightInput || !weightedCell) return;

    const gradeStr = gradeInput.value?.trim();
if (!gradeStr || isNaN(parseFloat(gradeStr))) return;
const grade = parseFloat(gradeStr);
    const weight = parseFloat(weightInput.value || 0);
    const weighted = (grade * weight) / 100;

    weightedCell.textContent = !isNaN(weighted) ? weighted.toFixed(2) : "0.00";
    total += !isNaN(weighted) ? weighted : 0;
  });

  document.getElementById('total-grade').textContent = total.toFixed(2);
}

function toggleGradeMode(mode) {
  localStorage.setItem('grade_mode', mode);

  const gradeInputs = document.querySelectorAll('.grade-input');
  const weightInputs = document.querySelectorAll('.weight-input');

  const presets = {
    midterm: {
      Activities: { weight: 24, grade: <?= json_encode($activitiesAvg ?? 0) ?> },
      Quizzes: { weight: 36, grade: <?= json_encode($quizzesAvg ?? 0) ?> },
      Exams: { weight: 40, grade: <?= json_encode($midtermAvg ?? 0) ?> }
    },
    finals: {
      Activities: { weight: 24, grade: <?= json_encode($activitiesAvg ?? 0) ?> },
      Quizzes: { weight: 36, grade: <?= json_encode($quizzesAvg ?? 0) ?> },
      Exams: { weight: 40, grade: <?= json_encode((($midtermAvg ?? 0) * 15 + ($finalExamAvg ?? 0) * 25) / 40) ?> }
    }
  };

  if (mode === 'manual') {
    gradeInputs.forEach(i => i.readOnly = false);
    weightInputs.forEach(i => i.readOnly = false);
  } else {
    gradeInputs.forEach(input => {
      const label = input.closest('tr').cells[0].textContent.trim();
      if (presets[mode][label]) {
        input.value = presets[mode][label].grade.toFixed(2);
        input.readOnly = true;
      }
    });

    weightInputs.forEach(input => {
      const label = input.closest('tr').cells[0].textContent.trim();
      if (presets[mode][label]) {
        input.value = presets[mode][label].weight;
        input.readOnly = true;
      }
    });
  }

  calculateDynamicGrades();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveRow(btn));
  });

  document.querySelectorAll('.grade-input, .weight-input').forEach(input => {
    input.addEventListener('input', calculateDynamicGrades);
  });

  document.querySelectorAll('.score, .items').forEach(input => {
    input.addEventListener('input', () => updateGrade(input));
  });

  const savedMode = localStorage.getItem('grade_mode') || 'finals';
  toggleGradeMode(savedMode);
});
</script>















</body>

</html>