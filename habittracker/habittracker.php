<?php
session_start();
if (!isset($_SESSION['user_id'], $_SESSION['first_name'])) {
    header('Location: ../login.php');
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

// ✅ Assign user_id from session
$user_id = $_SESSION['user_id'];
$first_name = htmlspecialchars($_SESSION['first_name']);

// Date context
date_default_timezone_set('Asia/Manila');
$todayDate = date('Y-m-d');
$todayDay = date('l');

// ✅ Update habits
$conn->query("
    UPDATE habit_tasks 
    SET task_status = CASE 
        WHEN FIND_IN_SET('$todayDay', days_of_week) > 0 THEN 'active'
        ELSE 'archived'
    END
    WHERE user_id = $user_id
");

// ADD HABIT
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'add') {
    $name = $_POST['habit_name'];
    $purpose = $_POST['purpose'];
    $urgency = $_POST['habit_urgency'];
    $category = $_POST['habit_category'];
    $type = $_POST['habit_type'];
    $days = $_POST['days_of_week'];
    $days_str = implode(",", $days);
    $times = count($days);

    $stmt = $conn->prepare("INSERT INTO habit_tasks 
        (user_id, task_name, purpose, habit_urgency, task_category, habit_type, days_of_week, times_per_week) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("issssssi", $user_id, $name, $purpose, $urgency, $category, $type, $days_str, $times);
    $stmt->execute();
    echo 'added'; exit;
}

// UPDATE HABIT
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'update') {
    $habit_id = intval($_POST['habit_id']);
    $name = $_POST['habit_name'];
    $purpose = $_POST['purpose'];
    $urgency = $_POST['habit_urgency'];
    $category = $_POST['habit_category'];
    $type = $_POST['habit_type'];
    $days = $_POST['days_of_week'];
    $days_str = implode(",", $days);
    $times = count($days);

    $stmt = $conn->prepare("UPDATE habit_tasks 
        SET task_name=?, purpose=?, habit_urgency=?, task_category=?, habit_type=?, days_of_week=?, times_per_week=? 
        WHERE habit_id=? AND user_id=?");
    $stmt->bind_param("sssssssii", $name, $purpose, $urgency, $category, $type, $days_str, $times, $habit_id, $user_id);
    $stmt->execute();
    echo 'updated'; exit;
}

// DELETE HABIT
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'delete') {
    $habit_id = intval($_POST['habit_id']);
    $stmt = $conn->prepare("DELETE FROM habit_tasks WHERE habit_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $habit_id, $user_id);
    $stmt->execute();
    echo 'deleted'; exit;
}

// ✅ CHECK-IN LOGIC
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'checkin') {
    $habit_id = intval($_POST['habit_id']);

    // Insert or update check-in
    $stmt = $conn->prepare("INSERT INTO habit_checkins (habit_id, checkin_date, is_completed) VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE is_completed = 1");
    $stmt->bind_param("is", $habit_id, $todayDate);
    $stmt->execute();

    // Update or start streak
    $check = $conn->query("SELECT * FROM habit_streaks WHERE habit_id = $habit_id AND user_id = $user_id ORDER BY streak_id DESC LIMIT 1");
    if ($check->num_rows > 0) {
        $row = $check->fetch_assoc();
        $prev_end = $row['streak_end'] ?? $row['streak_start'];
        $next_expected = date('Y-m-d', strtotime($prev_end . ' +1 day'));

        if ($todayDate === $next_expected) {
            $current = $row['current_streak_days'] + 1;
            $longest = max($row['longest_streak'], $current);
            $update = $conn->prepare("UPDATE habit_streaks SET current_streak_days=?, longest_streak=?, streak_end=? WHERE streak_id=?");
            $update->bind_param("iisi", $current, $longest, $todayDate, $row['streak_id']);
            $update->execute();
        } else {
            $stmt = $conn->prepare("INSERT INTO habit_streaks 
                (user_id, habit_id, streak_start, streak_end, current_streak_days, longest_streak) 
                VALUES (?, ?, ?, ?, 1, 1)");
            $stmt->bind_param("iiss", $user_id, $habit_id, $todayDate, $todayDate);
            $stmt->execute();
        }
    } else {
        $stmt = $conn->prepare("INSERT INTO habit_streaks 
            (user_id, habit_id, streak_start, streak_end, current_streak_days, longest_streak) 
            VALUES (?, ?, ?, ?, 1, 1)");
        $stmt->bind_param("iiss", $user_id, $habit_id, $todayDate, $todayDate);
        $stmt->execute();
    }

    echo 'checked_in'; exit;
}

// 🔄 UNDO CHECK-IN
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'undo_checkin') {
    $habit_id = intval($_POST['habit_id']);

    // Delete today's check-in
    $conn->query("DELETE FROM habit_checkins WHERE habit_id = $habit_id AND checkin_date = '$todayDate'");

    // Recalculate streak
    $latest_checkin = $conn->query("
        SELECT MAX(checkin_date) AS last_date 
        FROM habit_checkins 
        WHERE habit_id = $habit_id AND is_completed = 1 AND checkin_date < '$todayDate'
    ")->fetch_assoc()['last_date'];

    if ($latest_checkin) {
        $checkins_count = $conn->query("
            SELECT COUNT(*) AS count 
            FROM habit_checkins 
            WHERE habit_id = $habit_id AND is_completed = 1 AND checkin_date <= '$latest_checkin'
        ")->fetch_assoc()['count'];

        $update = $conn->prepare("UPDATE habit_streaks 
            SET streak_end = ?, current_streak_days = ? 
            WHERE habit_id = ? AND user_id = ?");
        $update->bind_param("siii", $latest_checkin, $checkins_count, $habit_id, $user_id);
        $update->execute();
    } else {
        $conn->query("DELETE FROM habit_streaks WHERE habit_id = $habit_id AND user_id = $user_id");
    }

    echo 'undone'; exit;
}

// 🔁 RESET STREAK
// RESET STREAK
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'reset_streak') {
    $habit_id = intval($_POST['habit_id']);
    $stmt = $conn->prepare("DELETE FROM habit_streaks WHERE habit_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $habit_id, $user_id);
    $stmt->execute();
    echo 'streak_reset';
    exit;
}

// UNDO STREAK (remove today’s check-in and update streak)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST['action'] === 'undo_streak') {
    $habit_id = intval($_POST['habit_id']);

    // Step 1: Delete today's check-in
    $stmt = $conn->prepare("DELETE FROM habit_checkins WHERE habit_id = ? AND checkin_date = ?");
    $stmt->bind_param("is", $habit_id, $todayDate);
    $stmt->execute();

    // Step 2: Fetch the latest streak
    $check = $conn->prepare("SELECT * FROM habit_streaks WHERE habit_id = ? AND user_id = ? ORDER BY streak_id DESC LIMIT 1");
    $check->bind_param("ii", $habit_id, $user_id);
    $check->execute();
    $result = $check->get_result();

    if ($result->num_rows > 0) {
        $streak = $result->fetch_assoc();

        // If streak_end is today, shorten it and decrease current_streak_days
        if ($streak['streak_end'] === $todayDate) {
            if ($streak['current_streak_days'] > 1) {
                $new_end = date('Y-m-d', strtotime($todayDate . ' -1 day'));
                $new_days = $streak['current_streak_days'] - 1;
                $update = $conn->prepare("UPDATE habit_streaks SET streak_end = ?, current_streak_days = ? WHERE streak_id = ?");
                $update->bind_param("sii", $new_end, $new_days, $streak['streak_id']);
                $update->execute();
            } else {
                // If only 1 day streak, delete the record
                $delete = $conn->prepare("DELETE FROM habit_streaks WHERE streak_id = ?");
                $delete->bind_param("i", $streak['streak_id']);
                $delete->execute();
            }
        }
    }

    echo 'streak_undone';
    exit;
}


// FILTER HABITS
$where = "user_id = ?";
$params = [$user_id];
$types = "i";

$query = "SELECT * FROM habit_tasks WHERE $where ORDER BY task_status ASC, date_created DESC";
$stmt = $conn->prepare($query);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$habits_result = $stmt->get_result();
?>


<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><?php echo $first_name; ?>'s Habit Tracker</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after {
  box-sizing: border-box;
}
:root {
  --blue: #a6d8ff;
  --pink: #ffcde1;
  --purple: #d4b9ff;
  --light: rgba(255, 255, 255, 0.5);
  --bg-gradient: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
}

@keyframes gradientFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', sans-serif;
  background: var(--bg-gradient);
  background-size: 300% 300%;
  animation: gradientFlow 10s ease infinite;
  min-height: 100vh;
  color: #333;
}

/* === HEADER === */
.header {
  margin-left: 25px;
  padding: 3rem 2rem 1rem;
  text-align: left;
  font-size: 3rem;
  font-weight: 800;
  margin-left: 2rem;
      background: linear-gradient(to right, #f2a7c0, #74bcd9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
}

/* === TOP CONTROLS === */
.top-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  padding: 0 2rem 1rem;
  gap: 1.5rem;
  margin-top: 0.5rem;
}

.top-controls .add-btn {
  margin-left: 1rem;
}

.top-controls select {
  margin-left: 40px;
  margin-right: 1rem;
}

/* === SELECT DROPDOWN === */
select {
  padding: 0.6rem 1rem;
  border-radius: 12px;
  border: 1px solid #ccc;
  font-size: 1rem;
  background-color: #fff;
  color: #333;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

/* === ADD BUTTON === */
.add-btn {
  background: linear-gradient(to right, #fcb6c2, #d0c7f8);
  border: none;
  margin-right: 40px;
  padding: 0.9rem 1.6rem;
  border-radius: 14px;
  font-size: 1rem;
  cursor: pointer;
  color: white;
  font-weight: bold;
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.1);
  transition: background 0.3s ease, transform 0.2s ease;
}

.day-btn {
  margin: 4px;
  padding: 8px 12px;
  background: #e0e0e0;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
}

.day-btn.selected {
  background: #6c8efb;
  color: #fff;
}


.add-btn:hover {
  transform: scale(1.04);
  filter: brightness(1.05);
}

/* === MAIN CONTAINER === */
.main-container {
  margin-left: 50px;
  padding: 1rem 1.5rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  justify-content: center;
  margin-top: 0.5rem;
}

.habit-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 220px;   /* slightly taller */
  max-width: 300px;    /* slightly wider */
  background: rgba(255, 255, 255, 0.6);
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  backdrop-filter: blur(12px);
  animation: fadeIn 0.3s ease;
}

.habit-card:hover {
  transform: scale(1.08); /* scaled more on hover */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}

.habit-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.habit-title {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(to right, #4dabf5, #ec407a);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-align: left;
}

.habit-details {
  margin: 0.5rem 0;
  font-size: 0.9rem;
  color: #444;
  line-height: 1.4;
  text-align: left;
}

/* === STREAK BAR === */

.streak-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}

.streak-bar {
  height: 6px;
  background: #eee;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 0.6rem;
}

.streak-fill {
  height: 100%;
  background: linear-gradient(90deg, #fcb6c2, #d0c7f8);
  border-radius: 12px;
}
.streak-label {
  font-size: 10px;
  font-weight: bold;
  color: #333;
  min-width: 40px;
  text-align: right;
}

.habit-card {
  display: flex;
  margin-bottom: 50px;
  flex-direction: column;
  justify-content: space-between;
  min-height: 220px;   /* slightly taller */
  max-width: 300px;    /* slightly wider */
  background: rgba(255, 255, 255, 0.6);
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  backdrop-filter: blur(12px);
  animation: fadeIn 0.3s ease;
}

.habit-card:hover {
  transform: scale(1.08); /* scaled more on hover */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}

.habit-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.habit-title {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(to right, #4dabf5, #ec407a);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-align: left;
}

.habit-details {
  margin: 0.5rem 0;
  font-size: 0.9rem;
  color: #444;
  line-height: 1.4;
  text-align: left;
}

/* === STREAK BAR === */
.streak-bar {
  height: 6px;
  background: #eee;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 0.6rem;
}

.streak-percent{
  align-items: flex-start;
  transform: translateY(-5px);
}


.streak-percent {
  display: flex;
}

/* === CARD ACTIONS === */
.card-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
}

.card-actions button {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.8rem;
  transition: background 0.2s ease, transform 0.1s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.card-actions button:hover {
  transform: scale(1.05);
}

.check-btn {
  background: #9ae19d;
  color: #1e4620;
}

.edit-btn {
  background: #fce8a2;
  color: #665c00;
}

.delete-btn {
  background: #f58f8f;
  color: #fff;
}

/* === BADGES === */
.badges {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}

.badge {
  padding: 2px 8px;
  border-radius: 14px;
  font-size: 0.7rem;
  font-weight: 600;
  color: white;
  text-align: center;
}

/* === CATEGORY STYLES === */
.category.academic {
  background: #6c8efb; /* cool blue */
  color: #ffffff;
}

.category.health {
  background: #42c38b; /* vibrant green */
  color: #ffffff;
}

.category.household {
  background: #ffb46e; /* soft orange */
  color: #ffffff;
}

.category.life-goals,
.category.lifegoals {
  background: #f58fb1; /* soft pink */
  color: #ffffff;
}

.category.organizational {
  background: #51c4d3; /* soft teal */
  color: #ffffff;
}

.category.social {
  background: #f28585; /* warm coral red */
  color: #ffffff;
}

/* === URGENCY STYLES === */
.urgency.urgent {
  background: #f75b67; /* vivid red */
  color: #ffffff;
}

.urgency.priority {
  background: #f79f24; /* orange-yellow */
  color: #ffffff;
}

.urgency.important {
  background: #f7d324; /* bright yellow */
  color: #000000;
}

.urgency.not-important {
  background: #91cfff; /* soft sky blue */
  color: #003366;
}

.urgency.not-urgent {
  background: #b28eff; /* light purple */
  color: #ffffff;
}

/* === STATUS STYLES === */
.badge.status.archived {
  background-color: #555555;  /* dark gray */
  color: #dddddd;
  border: 1px solid #777777;
}

.badge.status.active {
  background-color: #00b894;  /* emerald green */
  color: #ffffff;
  border: 1px solid #008f73;
}


.top-controls .add-btn{
  width: 150px;
  height: 40px;
  
}


/* === MODAL === */
.modal {
  display: none;
  position: fixed;
  z-index: 9999;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.modal-content {
  background-color: #fff;
  margin: 10% auto;
  padding: 24px;
  border-radius: 16px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
}

.modal-content input,
.modal-content select,
.modal-content textarea {
  width: 100%;
  padding: 10px 14px;
  margin-top: 12px;
  border-radius: 10px;
  border: 1px solid #ccc;
  font-size: 0.95rem;
  height: 44px;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-color: #fff;
  resize: none; /* Optional: to prevent resizing */
    font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.4;
}


.modal-content input::placeholder,
.modal-content textarea::placeholder {
  font-family: inherit;
  font-size: 0.95rem;
  color: #888; /* Optional: unify placeholder color */
}

/* Add dropdown arrow for <select> to look clean */
.modal-content select {
  background-image: url("data:image/svg+xml;utf8,<svg fill='gray' height='20' viewBox='0 0 24 24' width='20' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px 16px;
  padding-right: 2rem;
}


.days-buttons {
  display: flex;
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 4px;
  margin-top: 10px;
}

.day-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 0.6rem;
  border-radius: 8px;
  border: 1px solid #ccc;
  background-color: #f1f1f1;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.2s ease;
}

.day-btn.active {
  background-color: #f59eb7;
  color: white;
  border-color: #f59eb7;
}

.modal-buttons {
  margin-top: 15px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.close-btn {
  background-color: #eee;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.save-btn {
  background-color: #f59eb7;
  color: white;
  border: none;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.home-btn {
  margin-left: auto;
  margin-right: 45px;
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
  transform: translateY(-50px); /* or remove this */
}

.home-btn i {
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-position: left center;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 2rem;
}

/* === RESPONSIVE === */
@media screen and (max-width: 600px) {
  .top-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .card-actions {
    flex-direction: column;
  }

  .card-actions button {
    margin-bottom: 6px;
  }

  .habit-card {
    padding: 1.2rem;
  }

  .main-container {
    padding: 1.2rem;
    gap: 1rem;
  }

  .header {
    font-size: 2.1rem;
    margin-left: 1rem;
  }

  .top-controls .add-btn,
  .top-controls select {
    width: 100%;
    margin: 0;
  }
}

/* === FADE IN === */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

</head>

<body>
  <!-- Header -->
  <div class="header"><?= $first_name ?>'s Habit Tracker
  <button class="home-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/dashboard/dashboard.php'">
        <i class="fa-solid fa-house"></i>
   </button>
</div>

  <!-- Add Habit Modal -->
  <div id="habitModal" class="modal">
    <div class="modal-content">
      <h3>Add New Habit</h3>
      <form id="addHabitForm" method="POST">
        <input type="hidden" name="action" value="add">

        <input type="hidden" name="habit_id" value="">
        <input type="text" name="habit_name" placeholder="Habit Name" required>
        <textarea name="purpose" placeholder="Purpose" required></textarea>

        <select name="habit_urgency" required>
          <option value="" disabled selected>Urgency</option>
          <option value="Urgent">Urgent</option>
          <option value="Priority">Priority</option>
          <option value="Important">Important</option>
          <option value="Not Important">Not Important</option>
          <option value="Not Urgent">Not Urgent</option>
        </select>

        <select name="habit_category" required>
          <option value="" disabled selected>Category</option>
          <option value="academic">Academic</option>
          <option value="household">Household</option>
          <option value="health">Health</option>
          <option value="social">Social</option>
          <option value="organizational">Organizational</option>
          <option value="life goals">Life Goals</option>
        </select>

        <select name="habit_type" required>
          <option value="" disabled selected>Type</option>
          <option value="habit">Habit</option>
          <option value="routine">Routine</option>
        </select>

        <!-- Days of the week as multi-select buttons -->
        <div class="days-buttons">
          <?php
            $days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
            foreach ($days as $d):
          ?>
            <button type="button" class="day-btn" data-day="<?= $d ?>" onclick="toggleDay(this)">
              <?= substr($d, 0, 3) ?>
            </button>
          <?php endforeach; ?>
        </div>
        <div id="daysInputs"></div>

        <div class="modal-buttons">
          <span class="close-btn" onclick="closeAddModal()">Cancel</span>
          <button type="submit" class="save-btn">Save</button>
        </div>
      </form>
    </div>
  </div>

<!-- Filter Section -->
<div class="top-controls">
  <select id="filterUnified">
    <optgroup label="Filter by Status">
      <option value="status:active">Active</option>
      <option value="status:archived">Archived</option>
      <option value="">All Habits</option>
    </optgroup>

    <optgroup label="Filter by Category">
      <option value="category:academic">Academic</option>
      <option value="category:household">Household</option>
      <option value="category:health">Health</option>
      <option value="category:social">Social</option>
      <option value="category:organizational">Organizational</option>
      <option value="category:life goals">Life Goals</option>
    </optgroup>

    <optgroup label="Filter by Urgency">
      <option value="urgency:Urgent">Urgent</option>
      <option value="urgency:Priority">Priority</option>
      <option value="urgency:Important">Important</option>
      <option value="urgency:Not Important">Not Important</option>
      <option value="urgency:Not Urgent">Not Urgent</option>
    </optgroup>

    <optgroup label="Filter by Day">
      <?php foreach ($days as $d): ?>
        <option value="day:<?= $d ?>"><?= $d ?></option>
      <?php endforeach; ?>
    </optgroup>
  </select>

  <button class="add-btn" onclick="openAddModal()">+ Add Habit</button>
</div>



<div class="main-container" id="habitList">
  <?php while ($habit = $habits_result->fetch_assoc()):
    $habit_id = (int)$habit['habit_id'];
    $times_per_week = max(1, (int)$habit['times_per_week']);
    $streak_days = 0;
    $today = date('Y-m-d');
    $today_day = date('l');
    $checked_in_today = false;

    // ✅ Get current streak
    $streak_q = $conn->prepare("SELECT current_streak_days FROM habit_streaks WHERE user_id=? AND habit_id=? ORDER BY streak_id DESC LIMIT 1");
    if ($streak_q) {
      $streak_q->bind_param("ii", $user_id, $habit_id);
      $streak_q->execute();
      $streak_result = $streak_q->get_result();
      if ($streak_result->num_rows > 0) {
        $row = $streak_result->fetch_assoc();
        $streak_days = (int)$row['current_streak_days'];
      }
      $streak_q->close();
    }

    $streak_percent = min(100, intval(($streak_days / $times_per_week) * 100));

    // ✅ Check if already checked in today
    $stmt = $conn->prepare("SELECT 1 FROM habit_checkins WHERE habit_id = ? AND checkin_date = ?");
    if ($stmt) {
      $stmt->bind_param("is", $habit_id, $today);
      $stmt->execute();
      $stmt->store_result();
      $checked_in_today = $stmt->num_rows > 0;
      $stmt->close();
    }

    // ✅ Handle day logic
    $habit_days = array_map('trim', explode(',', $habit['days_of_week']));
    $is_today_allowed = in_array($today_day, $habit_days);
    $is_disabled = !$is_today_allowed && !$checked_in_today;

    // ✅ Properly encode habit object for JS
    $habit_for_js = json_encode([
      'habit_id' => $habit_id,
      'task_name' => $habit['task_name'],
      'purpose' => $habit['purpose'],
      'habit_urgency' => $habit['habit_urgency'],
      'task_category' => $habit['task_category'],
      'habit_type' => $habit['habit_type'],
      'days_of_week' => $habit_days
    ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); // prevent XSS
  ?>
    <div class="habit-card"
         data-category="<?= htmlspecialchars($habit['task_category']) ?>"
         data-urgency="<?= htmlspecialchars($habit['habit_urgency']) ?>"
         data-days="<?= htmlspecialchars($habit['days_of_week']) ?>"
         data-status="<?= htmlspecialchars($habit['task_status']) ?>">

      <div class="habit-card-header">
        <div class="habit-title">💡 <?= htmlspecialchars($habit['task_name']) ?></div>
        <div class="badges">
          <span class="badge urgency <?= strtolower(str_replace(' ', '-', $habit['habit_urgency'])) ?>">
            <?= htmlspecialchars($habit['habit_urgency']) ?>
          </span>
          <span class="badge category <?= strtolower(str_replace(' ', '-', $habit['task_category'])) ?>">
            <?= ucwords(htmlspecialchars($habit['task_category'])) ?>
          </span>
          <span class="badge status <?= strtolower($habit['task_status']) ?>">
            <?= ucfirst(htmlspecialchars($habit['task_status'])) ?>
          </span>
        </div>
      </div>

      <div class="habit-details">
        <div><strong>Purpose:</strong> <?= nl2br(htmlspecialchars($habit['purpose'])) ?></div>
        <div><strong>Type:</strong> <?= ucfirst(htmlspecialchars($habit['habit_type'])) ?></div>
        <div><strong>Days:</strong> <?= str_replace(",", ", ", htmlspecialchars($habit['days_of_week'])) ?></div>
      </div>

      <div class="streak-bar-container" style="display: flex; align-items: center; gap: 10px;">
        <div class="streak-bar" style="flex: 1;">
          <div class="streak-fill" style="width: <?= $streak_percent ?>%"></div>
        </div>
        <div class="streak-percent" style="min-width: 40px; font-weight: bold;">
          <?= $streak_percent ?>%
        </div>
      </div>

      <div class="card-actions">
        <button class="check-btn <?= $checked_in_today ? 'checked' : '' ?>"
                onclick="<?= $checked_in_today ? "undoCheckin($habit_id)" : ($is_today_allowed ? "checkinHabit($habit_id, 1)" : '') ?>"
                <?= $is_disabled ? 'disabled title="Not scheduled for today"' : '' ?>>
          <?= $checked_in_today ? '↩️ Undo' : '✅ Done' ?>
        </button>

        <!-- ✅ Edit button now sends prefilled data -->
        <button class="edit-btn" onclick='editHabit(<?= $habit_for_js ?>)'>✏️ Edit</button>

        <button class="delete-btn" onclick="deleteHabit(<?= $habit_id ?>)">🗑️ Delete</button>
      </div>
    </div>
  <?php endwhile; ?>
</div>

  <!-- JS -->
 <script>
  const selectedDays = new Set();

  function toggleDay(button) {
    const day = button.dataset.day;
    if (selectedDays.has(day)) {
      selectedDays.delete(day);
      button.classList.remove('selected');
    } else {
      selectedDays.add(day);
      button.classList.add('selected');
    }
    updateDaysInputs();
  }

  function updateDaysInputs() {
    const container = document.getElementById('daysInputs');
    container.innerHTML = '';
    selectedDays.forEach(day => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'days_of_week[]';
      input.value = day;
      container.appendChild(input);
    });
  }

  function openAddModal() {
    document.getElementById('habitModal').style.display = 'block';
    document.getElementById('addHabitForm').reset();
    document.querySelector('#habitModal h3').textContent = 'Add New Habit';
    document.querySelector('input[name="action"]').value = 'add';
    document.querySelector('input[name="habit_id"]').value = '';

    selectedDays.clear();
    document.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));
    updateDaysInputs();

    const resetBtn = document.getElementById('resetStreakBtn');
    if (resetBtn) resetBtn.remove();
  }

  function closeAddModal() {
    document.getElementById('habitModal').style.display = 'none';
    document.getElementById('addHabitForm').reset();
    selectedDays.clear();
    document.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));
    updateDaysInputs();
  }

  function deleteHabit(habitId) {
    if (!confirm("Are you sure you want to delete this habit?")) return;
    fetch("", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "delete", habit_id: habitId })
    }).then(res => res.text()).then(data => {
      if (data.trim() === "deleted") location.reload();
    });
  }

  function checkinHabit(habitId) {
    fetch("", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "checkin", habit_id: habitId })
    }).then(res => res.text()).then(data => {
      if (data.trim() === "checked_in") location.reload();
    });
  }

  function resetStreak(habitId) {
    if (!confirm("Reset the streak for this habit?")) return;
    fetch("", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "reset_streak", habit_id: habitId })
    }).then(res => res.text()).then(data => {
      if (data.trim() === "streak_reset") {
        alert("Streak has been reset.");
        location.reload();
      }
    });
  }

  function editHabit(habit) {
    document.querySelector('#habitModal h3').textContent = 'Edit Habit';
    document.querySelector('input[name="action"]').value = 'update';
    document.querySelector('input[name="habit_id"]').value = habit.habit_id;
    document.querySelector('input[name="habit_name"]').value = habit.task_name;
    document.querySelector('textarea[name="purpose"]').value = habit.purpose;
    document.querySelector('select[name="habit_urgency"]').value = habit.habit_urgency;
    document.querySelector('select[name="habit_category"]').value = habit.task_category;
    document.querySelector('select[name="habit_type"]').value = habit.habit_type;

    selectedDays.clear();
    document.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));

    const days = habit.days_of_week || [];
    days.forEach(day => {
      selectedDays.add(day);
      const btn = document.querySelector(`.day-btn[data-day="${day}"]`);
      if (btn) btn.classList.add('selected');
    });
    updateDaysInputs();

    const modalFooter = document.querySelector('#habitModal .modal-content');
    if (!document.getElementById('resetStreakBtn')) {
      const resetBtn = document.createElement('button');
      resetBtn.id = 'resetStreakBtn';
      resetBtn.type = 'button';
      resetBtn.textContent = '🔁 Reset Streak';
      resetBtn.className = 'reset-streak-btn';
      resetBtn.style.marginTop = '10px';
      resetBtn.onclick = () => resetStreak(habit.habit_id);
      modalFooter.appendChild(resetBtn);
    }

    openAddModal();
  }

  function applyUnifiedFilter() {
  const filterValue = document.getElementById('filterUnified').value;

  if (!filterValue) {
    // 👇 Fallback to default active
    applyStatusFilter('active');
    return;
  }

  const [type, value] = filterValue.split(':');
  let matched = false;

  document.querySelectorAll('.habit-card').forEach(card => {
    const matches =
      (type === 'category' && card.dataset.category === value) ||
      (type === 'urgency' && card.dataset.urgency === value) ||
      (type === 'day' && (card.dataset.days || '').split(',').includes(value)) ||
      (type === 'status' && card.dataset.status === value);

    if (matches) matched = true;
    card.style.display = matches ? 'block' : 'none';
  });

  if (!matched && type !== 'status') {
    // 👇 If other filters don’t match, show active by default
    applyStatusFilter('active');
  }
}

  document.addEventListener('DOMContentLoaded', function () {
    // Handle filter dropdown
    applyStatusFilter('active');
    const filterDropdown = document.getElementById('filterUnified');
    if (filterDropdown) {
      filterDropdown.addEventListener('change', applyUnifiedFilter);
    }

    // Disable check-in buttons if today isn't in allowed days
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    document.querySelectorAll('.checkin-btn').forEach(button => {
      const allowedDays = button.dataset.days?.split(',').map(day => day.trim());
      if (!allowedDays.includes(today)) {
        button.disabled = true;
        button.title = `This habit is not scheduled for ${today}`;
      }
    });

    // Handle form submit
    const form = document.getElementById('addHabitForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const formData = new FormData(form);

        fetch("", {
          method: "POST",
          body: formData
        })
          .then(res => res.text())
          .then(data => {
            const trimmed = data.trim();
            if (trimmed === "added" || trimmed === "updated") {
              location.reload();
            } else {
              console.error("Unexpected response:", trimmed);
              alert("Something went wrong. Please try again.");
            }
          })
          .catch(err => {
            console.error("Submit error:", err);
            alert("Error saving habit.");
          });
      });
    }
  });

  function applyStatusFilter(status = 'active') {
  document.querySelectorAll('.habit-card').forEach(card => {
    card.style.display = (card.dataset.status === status) ? 'block' : 'none';
  });
}
</script>


</body>
</html>
