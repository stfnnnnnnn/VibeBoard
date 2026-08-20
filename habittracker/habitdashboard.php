<?php
session_start();
if (!isset($_SESSION['user_id'], $_SESSION['first_name'])) {
    header('Location: ../login.php');
    exit();
}

$user_id = $_SESSION['user_id'];
$first_name = htmlspecialchars($_SESSION['first_name']);

// DB connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// === Get active habit tasks ===
$task_stmt = $conn->prepare("
    SELECT habit_id, task_name, purpose, task_category, days_of_week, times_per_week, habit_type
    FROM habit_tasks
    WHERE user_id = ? AND task_status = 'active'
");
$task_stmt->bind_param("i", $user_id);
$task_stmt->execute();
$task_result = $task_stmt->get_result();

$habit_tasks = [];
while ($row = $task_result->fetch_assoc()) {
    $row['days_array'] = explode(',', $row['days_of_week']);
    $habit_tasks[$row['habit_id']] = $row;
}

// === Get streaks (current and longest per habit) ===
$streak_stmt = $conn->prepare("
    SELECT habit_id, current_streak_days, longest_streak
    FROM habit_streaks
    WHERE user_id = ?
");
$streak_stmt->bind_param("i", $user_id);
$streak_stmt->execute();
$streak_result = $streak_stmt->get_result();

$streaks = [];
while ($row = $streak_result->fetch_assoc()) {
    $streaks[$row['habit_id']] = [
        'current' => (int)$row['current_streak_days'],
        'longest' => (int)$row['longest_streak']
    ];
}

// === Get check-ins for last 7 days ===
$today = new DateTime();
$seven_days_ago = (clone $today)->modify('-6 days')->format('Y-m-d');
$today_str = $today->format('Y-m-d');

$checkin_result = [];
if (!empty($habit_tasks)) {
    $placeholders = implode(',', array_fill(0, count($habit_tasks), '?'));
    $query = "
        SELECT habit_id, checkin_date, is_completed
        FROM habit_checkins
        WHERE habit_id IN ($placeholders)
        AND checkin_date BETWEEN ? AND ?
    ";
    $checkin_stmt = $conn->prepare($query);
    $types = str_repeat('i', count($habit_tasks)) . 'ss';
    $params = array_merge(array_keys($habit_tasks), [$seven_days_ago, $today_str]);
    $checkin_stmt->bind_param($types, ...$params);
    $checkin_stmt->execute();
    $checkin_result = $checkin_stmt->get_result();
}

// === Daily and habit-wise tracking ===
$day_map = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
$day_counts = array_fill_keys($day_map, ['completed' => 0, 'total' => 0]);
$habit_progress = [];

if ($checkin_result) {
    while ($checkin = $checkin_result->fetch_assoc()) {
        $habit_id = $checkin['habit_id'];
        $completed = (bool)$checkin['is_completed'];
        $weekday = $day_map[date('w', strtotime($checkin['checkin_date']))];

        if (isset($habit_tasks[$habit_id]) && in_array($weekday, $habit_tasks[$habit_id]['days_array'])) {
            $day_counts[$weekday]['total']++;
            if ($completed) $day_counts[$weekday]['completed']++;

            if (!isset($habit_progress[$habit_id])) {
                $habit_progress[$habit_id] = ['completed' => 0, 'expected' => 0];
            }
            $habit_progress[$habit_id]['expected']++;
            if ($completed) $habit_progress[$habit_id]['completed']++;
        }
    }
}

// === Calculate daily % completion ===
$completion_percent_per_day = [];
foreach ($day_counts as $day => $data) {
    $completion_percent_per_day[$day] = $data['total'] > 0
        ? round(($data['completed'] / $data['total']) * 100)
        : 0;
}

// === Calculate habit weekly % progress ===
$habit_weekly_progress = [];
foreach ($habit_progress as $habit_id => $data) {
    $habit_weekly_progress[$habit_id] = $data['expected'] > 0
        ? round(($data['completed'] / $data['expected']) * 100)
        : 0;
}

// === Login streak summary ===
$login_stmt = $conn->prepare("
    SELECT streak_start, streak_end, current_streak_days, longest_streak
    FROM habit_streaks
    WHERE user_id = ?
    ORDER BY current_streak_days DESC
    LIMIT 1
");
$login_stmt->bind_param("i", $user_id);
$login_stmt->execute();
$login_result = $login_stmt->get_result();
$login_streak = $login_result->fetch_assoc() ?? [
    'current_streak_days' => 0,
    'longest_streak' => 0
];
?>



<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><?php echo $first_name; ?>'s Habit Tracker</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root {
  --blue: #a6d8ff;
  --pink: #ffcde1;
  --lavender: #e4d1ff;
  --aqua: #c2e9fb;
  --light-pink: #fce0ec;
  --light: rgba(255, 255, 255, 0.5);
  --glass-bg: rgba(255, 255, 255, 0.25);
  --glass-border: rgba(255, 255, 255, 0.4);
  --shadow: rgba(0, 0, 0, 0.15);
  --ring-gradient: conic-gradient(from 0deg, #ffcde1, #d4b9ff, #a6d8ff, #ffcde1);
  --bg-gradient: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', sans-serif;
  background: var(--bg-gradient);
  background-size: 300% 300%;
  animation: gradientFlow 12s ease infinite;
  min-height: 100vh;
  max-height: 150vh;
  overflow: hidden;
  color: #333;
}

@keyframes gradientFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* === HEADER === */
.header {
  padding: 2rem 2rem 1rem;
  text-align: left;
  font-size: 2.6rem;
  font-weight: 800;
  background: linear-gradient(to right, #f2a7c0, #74bcd9);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* === Bento Grid === */
.dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2rem;
  padding: 1rem 2rem 2rem;
  box-sizing: border-box;
  max-width: 100%;
}

/* === Card Design === */
.card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 10px 24px var(--shadow);
  padding: 1.2rem 1.4rem;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 220px;
}
.card-content canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}


/* === Card Header === */
.card h3 {
  margin-bottom: 0.65rem;
  font-size: 1.25rem;
  background: linear-gradient(to right, var(--pink), var(--blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* === Summary Values === */
.summary-value {
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(to right, #74bcd9, #f2a7c0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.4rem;
}

.streak-badge {
  background: linear-gradient(to right, #ffd9eb, #cbe8ff);
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 12px;
  display: inline-block;
  margin-top: 6px;
  box-shadow: 0 3px 6px var(--shadow);
}

/* === Filter Bar === */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 1rem 2rem;
  justify-content: center;
}

.filter-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 25px;
  font-weight: 600;
  background: linear-gradient(to right, #c2e9fb, #f9c5d1);
  color: #333;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  transition: all 0.25s ease;
}

.filter-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}

/* === Progress Bar === */
.progress-bar {
  width: 100%;
  height: 10px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.2);
  margin-top: 0.75rem;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(to right, var(--pink), var(--blue), var(--lavender));
  box-shadow: inset 0 0 4px white;
  transition: width 0.5s ease-in-out;
}

/* === Check-in Grid === */
.checkin-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-top: 0.6rem;
}

.checkin-day {
  width: 100%;
  padding-top: 100%;
  position: relative;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  box-shadow: 0 2px 6px var(--shadow);
}

.checkin-day.completed {
  background: linear-gradient(to top right, var(--blue), var(--pink));
}

.checkin-day::after {
  content: attr(data-day);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.68rem;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px #000;
}

/* === Category Tag === */
.category-pill {
  display: inline-block;
  padding: 5px 10px;
  border-radius: 14px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #444;
  background: linear-gradient(to right, #fbe3f0, #d1eafd);
  margin: 0.2rem 0 0.5rem;
  box-shadow: inset 0 1px 3px rgba(255,255,255,0.4);
}

/* === Ring Progress Circle === */
.ring {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: var(--ring-gradient);
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0.5rem auto;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}

.full-width {
  grid-column: 1 / -1;
}


.ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--glass-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1rem;
  color: #333;
}

/* === Tooltip === */
.tooltip {
  position: relative;
  display: inline-block;
  cursor: help;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 125%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 6px 10px;
  font-size: 0.75rem;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: 0.2s;
  z-index: 2;
}

.tooltip:hover::after {
  opacity: 1;
}

.category-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 15px;
}

.category-chart .bar {
  padding: 8px 14px;
  border-radius: 20px;
  color: #fff;
  font-weight: 500;
  position: relative;
  transition: all 0.3s ease;
  box-shadow: inset 0 0 0 1000px rgba(255, 255, 255, 0.05);
}

.category-chart .bar span {
  float: right;
  font-weight: 600;
}

.category-chart .academic {
  background: linear-gradient(to right, #a6d8ff, #b5e3ff);
}

.category-chart .health {
  background: linear-gradient(to right, #ffcde1, #f9a8c1);
}

.category-chart .social {
  background: linear-gradient(to right, #d4b9ff, #e2c5ff);
}

.category-chart .household {
  background: linear-gradient(to right, #c2e9fb, #d4f3ff);
}

</style>


</head>
<body>
  <!-- Header -->
  <div class="header">
    Hello, <?= htmlspecialchars($first_name) ?>!
  </div>

  <!-- Dashboard Grid -->
  <div class="dashboard">

    <!-- Login Streak -->
    <div class="card">
      <div class="card-header">Login Streak</div>
      <div class="card-content">
        <p>You've logged in <strong><?= $loginStreak ?? 0 ?> consecutive days</strong>. Keep the momentum!</p>
      </div>
    </div>

    <!-- Top Habit Streaks -->
    <div class="card">
      <div class="card-header">Top Habit Streaks</div>
      <div class="card-content">
        <ul>
          <?php if (!empty($topHabits)): ?>
            <?php foreach ($topHabits as $habit): ?>
              <li><?= htmlspecialchars($habit['habit_name']) ?> - <?= $habit['streak'] ?> days</li>
            <?php endforeach; ?>
          <?php else: ?>
            <li>No habits found.</li>
          <?php endif; ?>
        </ul>
      </div>
    </div>

    <!-- Weekly Completion -->
    <div class="card">
      <div class="card-header">Weekly Completion</div>
      <div class="card-content">
        <p><?= $weeklyCompletionPercent ?? 0 ?>% of your tasks completed this week.</p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: <?= $weeklyCompletionPercent ?? 0 ?>%;"></div>
        </div>
      </div>
    </div>

    <!-- Weekly Check-ins -->
    <div class="card">
      <div class="card-header">Weekly Check-ins</div>
      <div class="card-content">
        <ul>
          <?php if (!empty($weeklyCheckins) && is_array($weeklyCheckins)): ?>
            <?php foreach ($weeklyCheckins as $day => $count): ?>
              <li><?= htmlspecialchars($day) ?>: <?= $count ?> habits</li>
            <?php endforeach; ?>
          <?php else: ?>
            <li>No check-ins recorded this week.</li>
          <?php endif; ?>
        </ul>
      </div>
    </div>

    <!-- Completion by Category (Chart) -->
    <div class="card full-width">
      <div class="card-header">Completion by Category</div>
      <div class="card-content" style="height: 300px;">
        <canvas id="categoryChart"></canvas>
      </div>
    </div>

    <!-- Today's Habits -->
    <div class="card full-width">
      <div class="card-header">Today's Habits</div>
      <div class="card-content">
        <ul>
          <?php if (!empty($todaysHabits)): ?>
            <?php foreach ($todaysHabits as $habit): ?>
              <li>
                <?= htmlspecialchars($habit['habit_name']) ?>
                <button class="checkin-btn"
                        data-days="<?= htmlspecialchars($habit['days_of_week']) ?>"
                        onclick="checkIn(<?= $habit['habit_id'] ?>)">Check In</button>
              </li>
            <?php endforeach; ?>
          <?php else: ?>
            <li>No scheduled habits today.</li>
          <?php endif; ?>
        </ul>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="card">
      <div class="card-header">Quick Stats</div>
      <div class="card-content">
        <ul>
          <li>Total Habits: <?= $totalHabits ?? 0 ?></li>
          <li>Completed Today: <?= $completedToday ?? 0 ?></li>
          <li>Longest Streak: <?= $longestStreak ?? 0 ?> days</li>
          <li>Most Urgent: <?= htmlspecialchars($mostUrgentHabit ?? 'None') ?></li>
        </ul>
      </div>
    </div>

  </div> <!-- End of .dashboard -->




<!-- Chart.js CDN -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<script>
  // Global Chart variable to destroy if chart already exists
  let categoryChartInstance;

  document.addEventListener('DOMContentLoaded', function () {
    fetchAndRenderCategoryChart();
  });

  function fetchAndRenderCategoryChart() {
    fetch('fetch_category_completion.php') // assumes this returns JSON {success, categories, completionRates}
      .then(response => {
        if (!response.ok) throw new Error('Network response error');
        return response.json();
      })
      .then(data => {
        if (!data.success) {
          console.error("Backend error:", data.message);
          return;
        }

        const categories = data.categories;
        const rates = data.completionRates;

        if (categoryChartInstance) {
          categoryChartInstance.destroy();
        }

        const ctx = document.getElementById('categoryChart').getContext('2d');

        categoryChartInstance = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: categories,
            datasets: [{
              label: 'Completion %',
              data: rates,
              backgroundColor: [
                '#ffc1cc', // pastel pink
                '#a3d5ff', // pastel blue
                '#d4f3d4', // pastel green
                '#e0c3fc'  // pastel lavender
              ],
              borderRadius: 8,
              barThickness: 30
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return context.parsed.y + '% complete';
                  }
                }
              },
              legend: {
                display: false
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  callback: function(value) {
                    return value + '%';
                  },
                  stepSize: 20
                },
                grid: {
                  color: 'rgba(0,0,0,0.05)'
                }
              },
              x: {
                grid: {
                  display: false
                }
              }
            }
          }
        });
      })
      .catch(err => {
        console.error("Chart fetch error:", err);
      });
  }
</script>

</body>



