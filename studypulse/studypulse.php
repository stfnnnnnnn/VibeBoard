<?php
ob_start();
session_start();

if (!isset($_SESSION['user_id']) || !isset($_SESSION['first_name'])) {
    header("Location: ../login.php");
    exit();
}
$first_name = $_SESSION['first_name'];

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
};

$user_id = $_SESSION['user_id'];

// ✅ Reset logic (clears session and DB trimester rows)
if (isset($_GET['reset_days'])) {
    unset($_SESSION['selected_trimester']);
    unset($_SESSION['selected_ay']);
    unset($_SESSION['selected_start_date']);
    unset($_SESSION['selected_end_date']);
    unset($_SESSION['days_remaining']);

    $delete_stmt = $conn->prepare("DELETE FROM trimesters WHERE user_id = ?");
    $delete_stmt->bind_param("i", $_SESSION['user_id']);
    $delete_stmt->execute();
    $delete_stmt->close();

    header("Location: studypulse.php");
    exit();
}

// ✅ Get session/user vars
$user_id = $_SESSION['user_id'];
$first_name = htmlspecialchars($_SESSION['first_name']);
$semester = $_SESSION['selected_trimester'] ?? null;
$academic_year = $_SESSION['selected_ay'] ?? null;
$days_remaining = $_SESSION['days_remaining'] ?? null;

// ✅ Handle form input
if ($_SERVER['REQUEST_METHOD'] === 'POST' &&
    isset($_POST['trimester'], $_POST['academic_year'], $_POST['start_date'], $_POST['end_date'])) {

    $selected_trimester = $_POST['trimester'];
    $selected_ay = $_POST['academic_year'];
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Save to session
    $_SESSION['selected_trimester'] = $selected_trimester;
    $_SESSION['selected_ay'] = $selected_ay;
    $_SESSION['selected_start_date'] = $start_date;
    $_SESSION['selected_end_date'] = $end_date;

    // Check if entry exists
    $check_stmt = $conn->prepare("SELECT trimester_id FROM trimesters WHERE user_id = ? AND trimester_name = ? AND academic_year = ?");
    $check_stmt->bind_param("iss", $user_id, $selected_trimester, $selected_ay);
    $check_stmt->execute();
    $result = $check_stmt->get_result();

    if ($result->num_rows === 0) {
        // Insert new trimester
        $insert_stmt = $conn->prepare("INSERT INTO trimesters (user_id, trimester_name, academic_year, start_date, end_date) VALUES (?, ?, ?, ?, ?)");
        $insert_stmt->bind_param("issss", $user_id, $selected_trimester, $selected_ay, $start_date, $end_date);
        $insert_stmt->execute();
        $insert_stmt->close();
    } else {
        // Update existing
        $update_stmt = $conn->prepare("UPDATE trimesters SET start_date = ?, end_date = ? WHERE user_id = ? AND trimester_name = ? AND academic_year = ?");
        $update_stmt->bind_param("ssiss", $start_date, $end_date, $user_id, $selected_trimester, $selected_ay);
        $update_stmt->execute();
        $update_stmt->close();
    }

    $check_stmt->close();

    // ✅ Redirect to prevent form resubmission
    header("Location: studypulse.php");
    exit();
}

// ✅ Fallback: try to load from DB if session is incomplete
if (!$semester || !$academic_year) {
    $fetch_stmt = $conn->prepare("SELECT trimester_name, academic_year, start_date, end_date FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1");
    $fetch_stmt->bind_param("i", $user_id);
    $fetch_stmt->execute();
    $result = $fetch_stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        $_SESSION['selected_trimester'] = $semester = $row['trimester_name'];
        $_SESSION['selected_ay'] = $academic_year = $row['academic_year'];
        $_SESSION['selected_start_date'] = $row['start_date'];
        $_SESSION['selected_end_date'] = $row['end_date'];
    }

    $fetch_stmt->close();
}

// ✅ Defaults
$semester = $semester ?? '1st Trimester';
$academic_year = $academic_year ?? 'AY 2025–2026';

// ✅ Calculate days remaining (if not already set)
if (!isset($_SESSION['days_remaining'])) {
    $stmt = $conn->prepare("SELECT end_date FROM trimesters WHERE user_id = ? AND trimester_name = ? AND academic_year = ?");
    $stmt->bind_param("iss", $user_id, $semester, $academic_year);
    $stmt->execute();
    $result = $stmt->get_result();
    $trimester = $result->fetch_assoc();
    $stmt->close();

    if ($trimester && !empty($trimester['end_date'])) {
        $today = new DateTime();
        $end = new DateTime($trimester['end_date']);

        if ($today < $end) {
            $interval = $today->diff($end);
            $days_remaining = $interval->days;
        } else {
            $days_remaining = 0;
        }

        $_SESSION['days_remaining'] = $days_remaining;
    } else {
        $days_remaining = 'N/A';
    }
}

function getTotal($conn, $table, $user_id, $status = null, $urgency = null) {
    $query = "SELECT COUNT(*) as count FROM $table qt
              INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
              WHERE us.user_id = ?";
    $params = [$user_id];
    $types = "i";

    if ($status !== null) {
        $query .= " AND qt.status = ?";
        $params[] = $status;
        $types .= "s";
    }
    if ($urgency !== null) {
        $query .= " AND qt.urgency = ?";
        $params[] = $urgency;
        $types .= "s";
    }

    $stmt = $conn->prepare($query);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result()->fetch_assoc();
    return (int) $res['count'];
}

function fetchAverageGrade($conn, $table, $subject_id) {
    $stmt = $conn->prepare("SELECT grade FROM $table WHERE user_subject_id = ? AND grade IS NOT NULL");
    $stmt->bind_param("i", $subject_id);
    $stmt->execute();
    $grades = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    if (count($grades) === 0) return null;
    return array_sum(array_column($grades, 'grade')) / count($grades);
}

function fetchExamGrade($conn, $subject_id, $type) {
    $stmt = $conn->prepare("SELECT grade FROM exams WHERE user_subject_id = ? AND LOWER(exam_type) = LOWER(?) AND grade IS NOT NULL");
    $stmt->bind_param("is", $subject_id, $type);
    $stmt->execute();
    $grades = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    if (count($grades) === 0) return null;
    return array_sum(array_column($grades, 'grade')) / count($grades);
}


function getOverallGPA($conn, $user_id, $term = 'final') {
    $subjectQuery = $conn->prepare("SELECT user_subject_id FROM user_subjects WHERE user_id = ?");
    $subjectQuery->bind_param("i", $user_id);
    $subjectQuery->execute();
    $result = $subjectQuery->get_result();
    $subjects = $result->fetch_all(MYSQLI_ASSOC);
    $subjectQuery->close();

    $subjectGPAs = [];

    foreach ($subjects as $subject) {
        $subject_id = $subject['user_subject_id'];

        // Fetch grades
        $qAvg = fetchAverageGrade($conn, 'quizzes', $subject_id);
        $aAvg = fetchAverageGrade($conn, 'activities', $subject_id);
        $mid = fetchExamGrade($conn, $subject_id, 'midterm');
        $final = fetchExamGrade($conn, $subject_id, 'final exam');

        // Dynamic weighting
        $totalWeight = 0;
        $weightedSum = 0;

        if ($aAvg !== null) {
            $weightedSum += $aAvg * 24;
            $totalWeight += 24;
        }
        if ($qAvg !== null) {
            $weightedSum += $qAvg * 36;
            $totalWeight += 36;
        }

        if ($term === 'midterm') {
            if ($mid !== null) {
                $weightedSum += $mid * 40;
                $totalWeight += 40;
            }
        } else {
            if ($mid !== null) {
                $weightedSum += $mid * 15;
                $totalWeight += 15;
            }
            if ($final !== null) {
                $weightedSum += $final * 25;
                $totalWeight += 25;
            }
        }

        // Avoid division by 0
        if ($totalWeight === 0) continue;

        $rawGrade = round($weightedSum / $totalWeight, 2);
        $gpa = convertToGPA($rawGrade);
        $subjectGPAs[] = $gpa;
    }

    if (count($subjectGPAs) === 0) return 0;

    return round(array_sum($subjectGPAs) / count($subjectGPAs), 2);
}



if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['filter'])) {
    $filter = $_POST['filter'];
    $response = [];

    switch ($filter) {
        case 'activities':
            $response = [
                'col1' => getTotal($conn, 'activities', $user_id, 'Done'),
                'col2' => getTotal($conn, 'activities', $user_id, 'Pending'),
                'col3' => getTotal($conn, 'activities', $user_id),
                'col4' => getAverageGrade($conn, 'activities', $user_id)
            ];
            break;
        case 'quizzes':
            $response = [
                'col1' => getTotal($conn, 'quizzes', $user_id, 'Done'),
                'col2' => getTotal($conn, 'quizzes', $user_id, 'Pending'),
                'col3' => getTotal($conn, 'quizzes', $user_id),
                'col4' => getAverageGrade($conn, 'quizzes', $user_id)
            ];
            break;
        case 'exams':
            $response = [
                'col1' => getTotal($conn, 'exams', $user_id, 'Done'),
                'col2' => getTotal($conn, 'exams', $user_id, 'Pending'),
                'col3' => getTotal($conn, 'exams', $user_id),
                'col4' => getAverageGrade($conn, 'exams', $user_id)
            ];
            break;
        case 'duedate':
            $response = [
                'col1' => getTotal($conn, 'activities', $user_id, 'Pending'),
                'col2' => getTotal($conn, 'quizzes', $user_id, 'Pending'),
                'col3' => getTotal($conn, 'exams', $user_id, 'Pending'),
                'col4' => getTotal($conn, 'activities', $user_id, 'Pending') + getTotal($conn, 'quizzes', $user_id, 'Pending') + getTotal($conn, 'exams', $user_id, 'Pending')
            ];
            break;
        case 'urgency':
            $response = [
                'col1' => getTotal($conn, 'activities', $user_id, null, 'High'),
                'col2' => getTotal($conn, 'quizzes', $user_id, null, 'High'),
                'col3' => getTotal($conn, 'exams', $user_id, null, 'High'),
                'col4' => getTotal($conn, 'activities', $user_id, null, 'High') + getTotal($conn, 'quizzes', $user_id, null, 'High') + getTotal($conn, 'exams', $user_id, null, 'High')
            ];
            break;
    }

    header('Content-Type: application/json');
    echo json_encode($response);
    exit();
}
$stmt = $conn->prepare("SELECT COUNT(*) as count FROM user_subjects WHERE user_id = ?");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$subjectCount = $stmt->get_result()->fetch_assoc()['count'];
$stmt->close();

$midtermGPA = getOverallGPA($conn, $user_id, 'midterm');
$finalGPA = getOverallGPA($conn, $user_id, 'final');
// Handle default overview
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !isset($_POST['filter'])) {
    $today = new DateTime();
    $semester_end = new DateTime("2025-12-31"); // <-- Adjust as needed
    $days_remaining = $today->diff($semester_end)->days;

    $stmt = $conn->prepare("SELECT COUNT(*) as count FROM user_subjects WHERE user_id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $subject_count = $stmt->get_result()->fetch_assoc()['count'];
    $stmt->close();

    $midtermGPA = getOverallGPA($conn, $user_id, 'midterm');
    $finalGPA = getOverallGPA($conn, $user_id, 'final');

    $response = [
        'col1' => $subjectCount,
        'col2' => $daysRemaining,
        'col3' => $midtermGPA,
        'col4' => $finalGPA
    ];

    header('Content-Type: application/json');
    echo json_encode($response);
    exit();
}

function convertToGPA($grade) {
    if ($grade < 70) return 0.5;
    if ($grade < 75) return 1.0;
    if ($grade < 80) return 1.5;
    if ($grade < 85) return 2.0;
    if ($grade < 89) return 2.5;
    if ($grade <= 92) return 3.0;
    if ($grade <= 96) return 3.5;
    return 4.0;
}


function getGradeSum($conn, $table, $user_id) {
    $query = "SELECT grade FROM $table qt
              INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
              WHERE us.user_id = ? AND qt.grade IS NOT NULL";
    $stmt = $conn->prepare($query);
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $grades = array_column($res->fetch_all(MYSQLI_ASSOC), 'grade');
    return array_sum($grades);
}

function getCompletionPercentage($conn, $table, $user_id) {
    $total = getTotal($conn, $table, $user_id);
    $done = getTotal($conn, $table, $user_id, 'Done');

    if ($total === 0) return 0;
    return round(($done / $total) * 100, 1);
}

function getAverageGrade($conn, $table, $user_id) {
    $query = "SELECT grade FROM $table qt
              INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
              WHERE us.user_id = ? AND qt.grade IS NOT NULL";
    $stmt = $conn->prepare($query);
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $grades = array_column($res->fetch_all(MYSQLI_ASSOC), 'grade');

    if (count($grades) === 0) return 0;
    return round(array_sum($grades) / count($grades), 1);
}

$completion = [
    'Activity' => getCompletionPercentage($conn, 'activities', $user_id),
    'Quiz' => getCompletionPercentage($conn, 'quizzes', $user_id),
    'Exam' => getCompletionPercentage($conn, 'exams', $user_id)
];

$grades = [
    'Activity' => getAverageGrade($conn, 'activities', $user_id),
    'Quiz' => getAverageGrade($conn, 'quizzes', $user_id),
    'Exam' => getAverageGrade($conn, 'exams', $user_id)
];

?>


<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Study Pulse</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

    :root {
      --blue: #a6d8ff;
      --pink: #ffcde1;
      --purple: #d4b9ff;
      --light: rgba(255, 255, 255, 0.5);
      --bg-gradient: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
    }

    

    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', sans-serif;
      background: var(--bg-gradient);
      background-size: 300% 300%;
      animation: gradientFlow 10s ease infinite;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
      color: #333;
    }

    @keyframes gradientFlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .wrapper {
      max-width: 1280px;
      padding: 32px;
      width: 100%;
    }

    .top-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .top-bar h1 {
      font-size: 2.4rem;
      font-weight: 700;
      background: linear-gradient(to right, #4dabf5, #ec407a);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .top-bar h1 i {
      font-size: 2.2rem;
    }

    .my-subjects-btn {
      background: #fff;
      border-radius: 16px;
      padding: 8px 20px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .pill-home {
      margin-left: 460px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 20px;
      padding: 8px 16px;
      font-weight: 500;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      border: 1px solid #ddd;
      transition: background 0.3s;
    }

.pill-home:hover {
  background: rgba(255, 255, 255, 0.85); /* brighter than base */
  border-color: #4dabf5;                 /* highlight border */
  box-shadow: 0 4px 12px rgba(77, 171, 245, 0.3); /* optional glow */
}

    .controls, .tab-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom:20px;
      margin-right: 0;
    }

    .pill {
      background: rgba(255, 255, 255, 0.6);
      border-radius: 20px;
      padding: 8px 16px;
      font-weight: 500;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      border: 1px solid #ddd;
      transition: background 0.3s;
    }

    .pill:hover {
      background: #fff;
    }

    .pill.active {
      background: #fff;
      border: 2px solid #4dabf5;
    }

    .overview-box {
      background: rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(10px);
      padding: 24px;
      border-radius: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
    }

    .overview-box h2 {
      font-size: 1.4rem;
      font-weight: 600;
      margin-bottom: 20px;
    }

    .overview-grid {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }

    .stat {
      background: white;
      border-radius: 16px;
      padding: 20px;
      flex: 1 1 200px;
      text-align: center;
      box-shadow: 0 5px 15px rgba(0,0,0,0.05);
    }

    .stat h3 {
      font-size: 2rem;
      color: #26a69a;
      margin-bottom: 6px;
    }

    .stat span {
      font-weight: 500;
    }

.cards {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  padding: 20px;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  margin-bottom: 32px;
  display: flex;
  flex-direction: column;
  width: 97%;
  gap: 1.5rem;
}

/* === Grade Tracker Row === */
.grade-tracker-row {
  background: #fff;
  padding: 10px 16px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

/* === Task Group in a Row === */
.task-group {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.progress-label {
  font-weight: 600;
  font-size: 14px;
  color: #333;
  white-space: nowrap;
  flex-shrink: 0;
  transform: translateY(-2px); /* 👈 slightly elevate the label */
}

.progress-bar {
  flex: 1;
  height: 10px;
  background-color: #eee;
  border-radius: 10px;
  overflow: hidden;
  max-width: 1000px;
}

.progress-bar-offset {
  flex: 1;
  height: 10px;
  margin-left: 20px;
  background-color: #eee;
  border-radius: 10px;
  overflow: hidden;
  max-width: 1000px;
}

.progress-fill {
  height: 100%;
  border-radius: 10px;
  transition: width 0.4s ease-in-out;
}

.progress-fill.pink {
  background-color: #f8b6d2;
}

.progress-fill.blue {
  background-color: #add8f3;
}

.progress-percent {
  font-weight: 600;
  font-size: 14px;
  color: #444;
  white-space: nowrap;
  flex-shrink: 0;
}

/* === Grade Section === */
.grade-display {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 85px;
}

.grade-label {
  font-weight: 600;
  font-size: 14px;
  color: #444;
}

.grade-ring {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: bold;
  color: #333;
  background: conic-gradient(#a6c8ff 90%, #fff 0%);
}

.ring-label {
  font-size: 13px;
  font-weight: 600px;
}




    /* Modal Overlay */
.overlay.improved {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.prompt-box.improved {
  background: #ffffff;
  padding: 32px 28px;
  border-radius: 16px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  font-family: "Inter", sans-serif;
  animation: fadeIn 0.25s ease-in-out;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.prompt-box.improved h2 {
  font-size: 24px;
  color: #222;
  font-weight: 600;
  margin: 0 0 8px;
}

.prompt-box.improved .subtext {
  font-size: 15px;
  color: #555;
  margin: 0 0 10px;
  line-height: 1.5;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.input,
.prompt-box select,
.prompt-box input[type="number"],
.prompt-box input[type="date"] {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 15px;
  color: #222;
  background-color: #fff;
  box-sizing: border-box;
  appearance: none;
  transition: border-color 0.2s ease;
  line-height: 1.2;
  text-align: left;
}

.input:focus,
.prompt-box select:focus,
.prompt-box input[type="number"]:focus,
.prompt-box input[type="date"]:focus {
  border-color: #007bff;
  outline: none;
}

/* Button */
.primary-btn {
  width: 100%;
  background-color: #007bff;
  color: #fff;
  padding: 12px 0;
  border: none;
  font-size: 16px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.primary-btn:hover {
  background-color: #005dc4;
}

.primary-btn:active {
  transform: scale(0.98);
}

/* Animation */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to   { opacity: 1; transform: translateY(0); }
}

    .prompt-box {
      background: white;
      padding: 30px;
      border-radius: 16px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    }

    .prompt-box h2 {
      font-size: 1.6rem;
      margin-bottom: 12px;
    }

    .prompt-box input {
      padding: 10px 14px;
      border: 1px solid #ccc;
      border-radius: 10px;
      width: 100%;
      font-size: 1rem;
      margin-bottom: 16px;
    }

    .prompt-box button {
      padding: 10px 20px;
      border: none;
      border-radius: 10px;
      background-color: #4dabf5;
      color: white;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.3s;
    }

    .prompt-box button:hover {
      background-color: #2196f3;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  </style>
</head>
<body>
<?php if ($days_remaining === null || !isset($_SESSION['selected_trimester']) || !isset($_SESSION['selected_ay'])): ?>
<div class="overlay improved">
  <form method="POST" class="prompt-box improved">
    <h2>🎓 Set Current Trimester</h2>
    <p class="subtext">
      Hi <strong><?= htmlspecialchars($first_name) ?></strong>! To get started, please fill in the following details:
    </p>

    <!-- Trimester -->
    <div class="form-group">
      <label for="trimester">Trimester</label>
      <select name="trimester" required class="input">
        <option value="" disabled <?= !isset($_SESSION['selected_trimester']) ? 'selected' : '' ?>>Select trimester</option>
        <option value="1st Trimester" <?= ($_SESSION['selected_trimester'] ?? '') === '1st Trimester' ? 'selected' : '' ?>>1st Trimester</option>
        <option value="2nd Trimester" <?= ($_SESSION['selected_trimester'] ?? '') === '2nd Trimester' ? 'selected' : '' ?>>2nd Trimester</option>
        <option value="3rd Trimester" <?= ($_SESSION['selected_trimester'] ?? '') === '3rd Trimester' ? 'selected' : '' ?>>3rd Trimester</option>
      </select>
    </div>

    <!-- Academic Year -->
    <div class="form-group">
      <label for="academic_year">Academic Year</label>
      <select name="academic_year" required class="input">
        <option value="" disabled <?= !isset($_SESSION['selected_ay']) ? 'selected' : '' ?>>Select academic year</option>
        <option value="AY 2025–2026" <?= ($_SESSION['selected_ay'] ?? '') === 'AY 2025–2026' ? 'selected' : '' ?>>AY 2025–2026</option>
        <option value="AY 2024–2025" <?= ($_SESSION['selected_ay'] ?? '') === 'AY 2024–2025' ? 'selected' : '' ?>>AY 2024–2025</option>
      </select>
    </div>

    <!-- Start Date -->
    <div class="form-group">
      <label for="start_date">Start Date</label>
      <input type="date" name="start_date" required class="input"
        value="<?= $_SESSION['selected_start_date'] ?? '' ?>" />
    </div>

    <!-- End Date -->
    <div class="form-group">
      <label for="end_date">End Date</label>
      <input type="date" name="end_date" required class="input"
        value="<?= $_SESSION['selected_end_date'] ?? '' ?>" />
    </div>

    <button type="submit" class="primary-btn">✅ Save & Continue</button>
  </form>
</div>
<?php endif; ?>

<div class="wrapper">

  <!-- Top Bar -->
  <div class="top-bar">
      <h1><i class="fa-solid fa-wave-square"></i> Study Pulse</h1>
    <button class="my-subjects-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/studypulse/mysubjects.php'">My Subjects</button>
  </div>

 <!-- Filter Controls -->
<div class="controls filter-buttons">
  <button class="pill" data-filter="activities"><i class="fa-solid fa-tasks"></i> Tasks</button>
  <button class="pill" data-filter="exams"><i class="fa-solid fa-file-alt"></i> Exams</button>
  <button class="pill" data-filter="quizzes"><i class="fa-solid fa-question-circle"></i> Quizzes</button>
  <button class="pill" data-filter="duedate"><i class="fa-solid fa-calendar-day"></i> Due Date</button>
  <button class="pill" data-filter="urgency"><i class="fa-solid fa-bolt"></i> Urgency</button>
  <button class="pill-home" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/dashboard/dashboard.php'"><i class="fa-solid fa-house"></i></button>
  <form method="get" action="studypulse.php" style="display:inline;">
    <button name="reset_days" value="1" class="pill">Refresh Trimester Info</button>
  </form>
</div>

<!-- Default Overview -->
<div class="overview-box default-stats" id="default-overview">
  <h2><?= $first_name ?>'s <?= $semester ?> (<?= $academic_year ?>)</h2>
  <div class="overview-grid">
    <div class="stat"><h3><?= $subjectCount ?></h3><span>Subjects Enrolled</span></div>
    <div class="stat"><h3><?= $days_remaining !== null ? $days_remaining : '--' ?></h3><span>Days Remaining</span></div>
    <div class="stat"><h3><?= $midtermGPA ?></h3><span>Midterm GPA Estimate</span></div>
    <div class="stat"><h3><?= $finalGPA ?></h3><span>Final GPA Estimate</span></div>
  </div>
</div>

<!-- Filtered Overview (Dynamic, AJAX-Populated) -->
<div class="overview-box filtered-stats" id="filtered-overview" style="display:none;">
  <h2><?= $first_name ?>'s <?= $semester ?> (<?= $academic_year ?>)</h2>
  <div class="overview-grid">
    <div class="stat"><h3 id="col1">0</h3><span id="label1">Label 1</span></div>
    <div class="stat"><h3 id="col2">0</h3><span id="label2">Label 2</span></div>
    <div class="stat"><h3 id="col3">0</h3><span id="label3">Label 3</span></div>
    <div class="stat"><h3 id="col4">0</h3><span id="label4">Label 4</span></div>
  </div>
</div>

<!-- Grade + Completion Overview -->
<div class="cards" id="right-overview">
  <?php
  // 🧠 PHP Helper Logic (Must be in studypulse.php BEFORE this section)

  // Helper function to calculate completion and average grade
  function calculateOverview($conn, $user_id, $type, $tableName, $gradeColumn = 'grade') {
    // 👇 Use JOIN to access user_id via user_subjects
    $completionQuery = "
        SELECT 
            COUNT(*) AS total, 
            SUM(CASE WHEN $tableName.status = 'Done' THEN 1 ELSE 0 END) AS completed 
        FROM $tableName
        INNER JOIN user_subjects ON $tableName.user_subject_id = user_subjects.user_subject_id
        WHERE user_subjects.user_id = $user_id
    ";
    $result = $conn->query($completionQuery);
    $completion = $result->fetch_assoc();
    $percent = ($completion['total'] ?? 0) > 0 
        ? round(($completion['completed'] / $completion['total']) * 100) 
        : 0;

    // 🎯 Average grade (only for completed tasks with a grade)
    $gradeQuery = "
        SELECT 
            AVG($tableName.$gradeColumn) AS avg_grade 
        FROM $tableName
        INNER JOIN user_subjects ON $tableName.user_subject_id = user_subjects.user_subject_id
        WHERE user_subjects.user_id = $user_id 
            AND $tableName.status = 'done' 
            AND $tableName.$gradeColumn IS NOT NULL
    ";
    $gradeResult = $conn->query($gradeQuery);
    $grade = round($gradeResult->fetch_assoc()['avg_grade'] ?? 0);

    return ['completion' => $percent, 'grade' => $grade];
}

  $completionGrades = [
    'Activity' => calculateOverview($conn, $user_id, 'Activity', 'activities'),
    'Quiz'     => calculateOverview($conn, $user_id, 'Quiz', 'quizzes'),
    'Exam'     => calculateOverview($conn, $user_id, 'Exam', 'exams')
  ];
  ?>

  <?php foreach (['Activity' => '#f8a5c2', 'Quiz' => '#a6c8ff', 'Exam' => '#f8a5c2'] as $label => $color): ?>
    <div class="grade-tracker-row">
      <div class="task-group">
        <span class="progress-label"><?= $label ?> Progress</span>
        <div class="progress-bar">
          <div class="progress-fill" style="width: <?= $completionGrades[$label]['completion'] ?>%; background-color: <?= $color ?>;"></div>
        </div>
        <span class="progress-percent"><?= $completionGrades[$label]['completion'] ?>%</span>
      </div>
      <div class="grade-display">
        <div class="grade-label">Grade</div>
        <div class="grade-ring" style="background: conic-gradient(<?= $color ?> <?= $completionGrades[$label]['grade'] ?>%, #eee 0%)">
          <div class="ring-label"><?= $completionGrades[$label]['grade'] ?>%</div>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>

</div> <!-- end wrapper -->


<script>
document.addEventListener("DOMContentLoaded", function () {
  const buttons = document.querySelectorAll(".filter-buttons .pill");

  const labelMap = {
    activities: ['Accomplished Activities', 'Pending Activities', 'Total', 'Average Grade'],
    quizzes: ['Accomplished Quizzes', 'Upcoming Quizzes', 'Total', 'Average Grade'],
    exams: ['Accomplished Exams', 'Upcoming Exams', 'Total', 'Average Grade'],
    duedate: ['Pending Tasks', 'Pending Quizzes', 'Pending Exams', 'Total Pending'],
    urgency: ['Urgent Activities', 'Urgent Quizzes', 'Urgent Exams', 'Total Urgent']
  };

  let activeFilter = null; // Track the currently active filter

  // ✅ Load Default Overview on Page Load
  fetch("studypulse.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  .then(res => res.json())
  .then(data => {
    document.getElementById("default1").textContent = data.col1 ?? '0'; // Subjects Enrolled
    document.getElementById("default2").textContent = data.col2 ?? '0'; // Days Remaining
    document.getElementById("default3").textContent = data.col3 ?? '0'; // Midterm GPA
    document.getElementById("default4").textContent = data.col4 ?? '0'; // Final GPA

    document.getElementById("default-overview").style.display = "grid";
    document.getElementById("filtered-overview").style.display = "none";
    document.getElementById("filter-title").textContent = "Overall Overview";
  })
  .catch(err => {
    console.error("Default overview load error:", err);
  });

  // ✅ Handle Filter Clicks (with Toggle Off)
  buttons.forEach(button => {
    button.addEventListener("click", function () {
      const filterType = this.dataset.filter;

      // 🔁 Toggle off if clicking the same filter
      if (activeFilter === filterType) {
        activeFilter = null;
        buttons.forEach(btn => btn.classList.remove("active"));
        document.getElementById("default-overview").style.display = "grid";
        document.getElementById("filtered-overview").style.display = "none";
        document.getElementById("filter-title").textContent = "Overall Overview";
        return;
      }

      // 🔁 Otherwise, activate this filter
      activeFilter = filterType;
      buttons.forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");

      const labels = labelMap[filterType] || ['Col 1', 'Col 2', 'Col 3', 'Col 4'];

      fetch("studypulse.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "filter=" + encodeURIComponent(filterType)
      })
      .then(res => res.json())
      .then(data => {
        document.getElementById("col1").textContent = data.col1 ?? '0';
        document.getElementById("col2").textContent = data.col2 ?? '0';
        document.getElementById("col3").textContent = data.col3 ?? '0';
        document.getElementById("col4").textContent = data.col4 ?? '0';

        document.getElementById("label1").textContent = labels[0];
        document.getElementById("label2").textContent = labels[1];
        document.getElementById("label3").textContent = labels[2];
        document.getElementById("label4").textContent = labels[3];

        document.getElementById("filtered-overview").style.display = "grid";
        document.getElementById("default-overview").style.display = "none";
        document.getElementById("filter-title").textContent =
          filterType.charAt(0).toUpperCase() + filterType.slice(1) + " Overview";
      })
      .catch(err => {
        console.error("AJAX filter error:", err);
      });
    });
  });
});
</script>





</body>






</html>
