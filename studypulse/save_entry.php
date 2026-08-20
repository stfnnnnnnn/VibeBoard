<?php
ob_start(); // Prevent output before JSON

session_start();
ini_set('display_errors', 1);
error_reporting(E_ALL);

header("Content-Type: application/json");

// ✅ Debug: Save raw POST
file_put_contents("debug_post.txt", print_r($_POST, true));

// ✅ Session Check
if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Unauthorized"]);
    exit();
}

// ✅ DB Connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
$conn->set_charset("utf8mb4");

// ✅ Sanitize Input
$user_id         = $_SESSION['user_id'];
$user_subject_id = isset($_POST['user_subject_id']) ? intval($_POST['user_subject_id']) : 0;
$type            = isset($_POST['type']) ? trim($_POST['type']) : '';
$name            = isset($_POST['name']) ? trim($_POST['name']) : '';
$specific_type   = isset($_POST['specific_type']) ? trim($_POST['specific_type']) : '';
$urgency         = isset($_POST['urgency']) ? trim($_POST['urgency']) : '';
$status          = isset($_POST['status']) ? trim($_POST['status']) : '';
$deadline        = isset($_POST['deadline']) ? trim($_POST['deadline']) : '';

$grade           = (isset($_POST['grade']) && $_POST['grade'] !== '') ? floatval($_POST['grade']) : null;
$score           = (isset($_POST['score']) && $_POST['score'] !== '') ? floatval($_POST['score']) : null;
$items           = (isset($_POST['items']) && $_POST['items'] !== '') ? floatval($_POST['items']) : null;

$entry_id        = isset($_POST['entry_id']) ? intval($_POST['entry_id']) : 0;

// ✅ Validate Required Fields
if ($user_subject_id <= 0 || $name === '' || $type === '') {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required data."]);
    exit();
}

// ✅ Prepare Query (Insert or Update)
switch ($type) {
    case 'activities':
        if ($entry_id > 0) {
            $stmt = $conn->prepare("
                UPDATE activities SET
                    activity_name = ?, activity_type = ?, urgency = ?, status = ?, deadline = ?, grade = ?, score = ?, items = ?
                WHERE activity_id = ? AND user_subject_id = ?
            ");
            $stmt->bind_param(
                "sssssssddi",
                $name, $specific_type, $urgency, $status, $deadline, $grade, $score, $items,
                $entry_id, $user_subject_id
            );
        } else {
            $stmt = $conn->prepare("
                INSERT INTO activities (
                    user_subject_id, activity_name, activity_type,
                    urgency, status, deadline, grade, score, items
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->bind_param(
                "isssssddd",
                $user_subject_id, $name, $specific_type,
                $urgency, $status, $deadline, $grade, $score, $items
            );
        }
        break;

    case 'quizzes':
        if ($entry_id > 0) {
            $stmt = $conn->prepare("
                UPDATE quizzes SET
                    quiz_name = ?, urgency = ?, status = ?, deadline = ?, grade = ?, score = ?, items = ?
                WHERE quiz_id = ? AND user_subject_id = ?
            ");
            $stmt->bind_param(
                "ssssssddi",
                $name, $urgency, $status, $deadline, $grade, $score, $items,
                $entry_id, $user_subject_id
            );
        } else {
            $quiz_number = 1;
            $stmt_check = $conn->prepare("SELECT MAX(quiz_number) FROM quizzes WHERE user_subject_id = ?");
            if ($stmt_check) {
                $stmt_check->bind_param("i", $user_subject_id);
                $stmt_check->execute();
                $stmt_check->bind_result($max_quiz);
                if ($stmt_check->fetch() && $max_quiz !== null) {
                    $quiz_number = $max_quiz + 1;
                }
                $stmt_check->close();
            }

            $stmt = $conn->prepare("
                INSERT INTO quizzes (
                    user_subject_id, quiz_name, quiz_number,
                    urgency, status, deadline, grade, score, items
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->bind_param(
                "isisssddd",
                $user_subject_id, $name, $quiz_number,
                $urgency, $status, $deadline, $grade, $score, $items
            );
        }
        break;

    case 'exams':
        if ($entry_id > 0) {
            $stmt = $conn->prepare("
                UPDATE exams SET
                    exam_name = ?, exam_type = ?, urgency = ?, status = ?, deadline = ?, grade = ?, score = ?, items = ?
                WHERE exam_id = ? AND user_subject_id = ?
            ");
            $stmt->bind_param(
                "sssssssddi",
                $name, $specific_type, $urgency, $status, $deadline, $grade, $score, $items,
                $entry_id, $user_subject_id
            );
        } else {
            $stmt = $conn->prepare("
                INSERT INTO exams (
                    user_subject_id, exam_name, exam_type,
                    urgency, status, deadline, grade, score, items
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->bind_param(
                "isssssddd",
                $user_subject_id, $name, $specific_type,
                $urgency, $status, $deadline, $grade, $score, $items
            );
        }
        break;

    default:
        http_response_code(400);
        echo json_encode(["status" => "error", "message" => "Invalid entry type."]);
        exit();
}

// ✅ Execute
if ($stmt->execute()) {
    $new_entry_id = ($entry_id > 0) ? $entry_id : $stmt->insert_id;
    echo json_encode([
        "status"        => "success",
        "entry_id"      => $new_entry_id,
        "type"          => $type,
        "score"         => $score,
        "items"         => $items,
        "grade"         => $grade,
        "specific_type" => $specific_type,
        "name"          => $name,
        "urgency"       => $urgency,
        "status_text"   => $status,
        "deadline"      => $deadline
    ]);
} else {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Failed to save: " . $stmt->error]);
}

// ✅ Cleanup
$stmt->close();
$conn->close();
ob_end_flush();
?>
