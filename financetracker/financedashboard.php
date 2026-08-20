<?php
session_start();

// ✅ DB Connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// ✅ Check Session
if (!isset($_SESSION['user_id'])) {
    header("Location: ../login.php");
    exit();
}

$user_id = $_SESSION['user_id'];
$first_name = $_SESSION['first_name'];

?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Finance Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
  
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Finance Tracker</title>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Finance Tracker Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <style>
    :root {
  --transportation-color: #aed581;
  --grocery-color: #ffd54f;
  --food-color: #ff7043;
  --academic-color: #7986cb;
  --family-color: #f06292;
  --leisure-color: #ba68c8;
  --emergency-color: #e57373;
  --miscellaneous-color: #bcaaa4;
  --healthcare-color: #4dd0e1;
  --utilities-color: #90a4ae;
  --donation-color: #aed581;
  --emergency-fund-color: #4db6ac;
  --travel-color: #81d4fa;
  --gift-color: #ffcc80;
  --investment-color: #a5d6a7;
  --wishlist-color: #ce93d8;
  --future-allocation-color: #ffe082;
}
  * {
    margin: 0; padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Poppins', sans-serif;
  }

          @keyframes gradientFlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

  body {
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 12s ease infinite;
    min-height: 100vh;
    padding: 30px 20px 160px;
    color: #333;
  }

  h1 {
    text-align: left;
    margin-left: 20px;
    font-size: 2rem;
    font-weight: 800;
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

    .h3-text {
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .h2 text-header{
        text-align: center;
    font-size: 2rem;
    font-weight: 800;
    margin-bottom: 20px;
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent
  }

    .logo-text{
    text-align: center;
    display: flex;
    flex: nowrap;
    font-size:1.2rem;
    font-weight: 800;
    margin-bottom: 10px;
    }

 .dashboard {
  max-width: 1400px;
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  padding: 24px;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.card-box {
  background: rgba(255, 255, 255, 0.25); /* More transparent */
  backdrop-filter: blur(20px);           /* Stronger blur = more glassmorphic */
  -webkit-backdrop-filter: blur(20px);   /* For Safari support */
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.1); /* Deeper shadow for "floating" effect */
  border: 1px solid rgba(255, 255, 255, 0.3); /* Light frosty border */
}

  .top-row {
    display: grid;
    grid-template-columns: 0.9fr 0.9fr;
    gap: 24px;
  }

  .bottom-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: stretch;
  }
.weekly-tracker-combined.full-row-tracker,
.card-box.goal-tracker {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.full-row-tracker,
.goal-tracker {
  min-height: 100%;
}
  .allocator-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}


  .summary-grid-wrapper {
    display: flex;
    flex-direction: row;
    gap: 26px;
  }

  .summary-grid {
    display: flex;
    justify-content: space-between;
    grid-template-columns: repeat(4, 1fr);
    gap: 26px;
  }

  .summary-card {
    background: rgba(255, 255, 255, 0.8);
    padding: 16px 24px;
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.05);
    text-align: center;
    font-weight: 600;
    border: 1px solid rgba(0, 0, 0, 0.05);
    min-width: 300px;
    max-width: 360px;
    min-height: 20px;
  }

  .summary-card span {
    display: block;
    font-size: 1.1rem;
    font-weight: 800;
    color: #4dabf5;
  }

    .summary-card h2{
    display: block;
    font-size: 1.1rem;
    font-weight: 800;
    color: #a484c4;
  }

.tracker-duo {
  display: flex;
  gap: 20px;
  justify-content: space-between;
  align-items: stretch;
  flex-wrap: nowrap; /* prevent wrapping */
}

.weekly-tracker-combined {
  flex: 1;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  gap: 20px;
  padding: 20px;
    background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 20px;
  gap: 20px;
  box-sizing: border-box;
}

/* 🔤 Header text */
.tracker-header h2 {
  font-size: 1.1rem;
  margin: 0;
  font-weight: bold;
  color: #555;
     background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.tracker-header button{
  color:#fff;
  font-weight: 700;
}

.allowance-week {
  display: flex;
  align-items: flex;
  flex-direction: column;
  gap: 10px;
}
.expense-seg {
  justify-content: flex-start;
}

.savings-seg {
  justify-content: flex-end;
}

.barseg-label {
  width: 30px;
  font-size: 11px;
  font-weight: 700;
  color: #a484c4;
}


/* 🔳 Segments */
.tracker-segment {
  border: none;
  flex: 0 1 48%;
  min-width: 280px;
  display: flex;
  flex-direction: column;
}

/* 🔠 Header alignment */
.tracker-header {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 10px;
  border: none;
}

.tracker-left-header .header-group,
.tracker-right-header .header-group {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.tracker-right-header .header-group {
  flex-direction: row-reverse;
  justify-content: flex-end;
  gap: 20px;
}
.tracker-right-header h2 {
text-align: right;
}

/* 🔘 Filter buttons */
/* 🎛️ Filter dropdown buttons */
.tracker-filter {
  display: inline-block; /* prevent stretching */
  white-space: nowrap;   /* keep text on one line */
  max-width: 90px;      /* set a max width if needed */
  padding: 4px 10px;
  border: none;
  border-radius: 999px;
  background-color: #007BFF;
  color: white;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.3s ease;
  text-align: left;
}

.tracker-filter:hover {
  background-color: #0056b3;
}

/* 🧱 Align "Expenses by Category" content to top */
.tracker-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}
.header-group-right-aligned{
  display: inline-block; /* prevent stretching */
  white-space: nowrap;   /* keep text on one line */
}

/* 📊 Bar Pill Chart Styling */
.barseg-week {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
}

.barseg-item {
  display: flex;
  align-items: center;
  gap: 10px;
}


.barseg-label {
  width: 40px;
  font-weight: bold;
  text-align: right;
}

.barseg-bar {
  flex: 1;
  background: #eee;
  height: 12px;
  border-radius: 20px;
  overflow: hidden;
}

.barseg-fill {
  height: 100%;
  border-radius: 20px;
}

.barseg-exp {
  background-color: #f28b82;
}

.barseg-sav {
  background-color: #81c995;
}

/* 🍩 Donut Chart Centered */
.donut-chart-container {
  margin-top: 10px;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
  gap: 30px; /* <-- NEW: spacing between donut and legend */
}

.donut-ring {
  position: relative;
  width: 130px;
  height: 130px;
  border-radius: 50%;
  margin-bottom: 10px;
}


.donut-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.donut-legend {
  max-width: 90px;
  margin-right: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}


/* 📉 Smaller legend text */
.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  font-weight: 700;
  color: #4dabf5;
}

.donut-palette {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
}

.donut-center-label{
  display: none;
}
.full-row-tracker {
  width: 100%;
  flex-direction: column; /* Ensures it's stacked cleanly */
  display: flex;
  gap: 20px; /* Optional spacing between header and bars */
}

.full-row-tracker .tracker-segment {
  width: 100%;
}


   .goal-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr); /* 4 equal columns */
  gap: 0.3rem;
}

  .goal-entry {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(10px);
    border-radius: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid rgba(164, 132, 196, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    height: 50;
  }

  .goal-name {
    font-size: 0.8rem;
    font-weight: 700;
    color: #4dabf5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .goal-progress-bar {
    width: 100%;
    height: 10px;
    border-radius: 999px;
    background-color: #f1e6ff;
    overflow: hidden;
  }

  .goal-progress-fill {
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(to right, #a484c4, #d1a3ff);
    transition: width 0.3s ease-in-out;
  }

  .goal-percentage {
    font-size: 0.7rem;
    font-weight: 800;
    text-align: right;
    color: #4dabf5;
  }

  .input-with-buttons input[type="text"] {
    width: 100%;
    padding: 7px 10px;
    border-radius: 10px;
    border: 1px solid #a484c4;
    color: #a484c4;
  }

  /* Control Container */
.goal-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.3rem;
}

/* Search input */
.goal-search {
  flex-grow: 1;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid #a484c4;
  color: #a484c4;
  height: 30px;
}

/* Entry count selector */
.goal-select-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: #a484c4;
}

.goal-select {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #a484c4;
  font-weight: 700;
  color: #a484c4;
  background-color: #fff;
}

/* Refresh button */
.goal-refresh-btn {
  padding: 7px 12px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid #a484c4;
  color: #a484c4;
  background-color: #fff;
  cursor: pointer;
  font-weight: 700;
  transition: 0.2s ease;
}

.goal-refresh-btn:hover {
  background-color: #e6d4ff;
}
.amount-input-group {
  margin-bottom: 5px;
}

.input-with-buttons {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 5px;
}

.input-with-buttons input[type="number"] {
  flex: 1;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
}

.input-with-buttons button {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background-color: #5a9;
  color: white;
  cursor: pointer;
  transition: background 0.3s ease;
}

.input-with-buttons button:hover {
  background-color: #48a;
}


  /* Category-based column cards */
  .category-column {
    background: rgba(255, 255, 255, 0.55);
    backdrop-filter: blur(12px);
    border-radius: 20px;
    padding: 24px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.07);
    border: 1px solid rgba(255,255,255,0.2);
  }

  @media (max-width: 900px) {
    .top-row, .bottom-row {
      grid-template-columns: 1fr;
    }
  }

 .title-with-home {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px; /* space between title, button, and filter */
  flex-wrap: nowrap;
  padding: 10px 20px;
}


/* Home button styling (already mostly fine) */
.title-with-home {
  display: flex;
  align-items: center;
  justify-content: space-between; /* Push title left, others right */
  padding: 10px 20px;
}

/* Right-side wrapper for home + filter */
.right-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Home button */
.home-btn {
  background: #f5f5f5;
  margin-right: 20px;
  border: none;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 1rem;
  cursor: pointer;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.08));
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  width: 40px;
}

/* Home icon */
.home-btn i {
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-position: left center;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 1.5rem;
}

/* Filter dropdown container */
.filter-container {

  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  color: white;
  font-weight: 600;
}

.finances {
  border: none;
  background: linear-gradient(to right, #81d4fa, #f48fb1);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 10px;
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}

/* Filter dropdown styling */
.filter-container select {
    background: linear-gradient(to right, #81d4fa, #f48fb1);
  color: #333;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-weight: 600;
  cursor: pointer;
}

</style>

</head>
<body>
<div class="title-with-home">
  <h1><?= htmlspecialchars($first_name) ?>'s Finance Dashboard</h1>

  <div class="right-actions">
        <div class="filter-container">
      <label for="summary-filter"></label>
      <select id="summary-filter">
        <option value="month" selected>Week</option>
        <option value="year">Month</option>
        <option value="all">All Time</option>
      </select>
    </div>
    <button class="finances" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/financetracker/financetracking.php'">My Finances</button>
    <button class="home-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/dashboard/dashboard.php'">
      <i class="fa-solid fa-house"></i>
    </button>
  </div>
</div>


  <div class="dashboard">

        <!-- Summary Grid (2x2) -->
      <div class="summary-grid">
        <div class="summary-card"><h2>Allowance<br></h2><span id="total-allowance">₱0.00</span></div>
        <div class="summary-card"><h2>Expenses<br></h2><span id="total-expense">₱0.00</span></div>
        <div class="summary-card"><h2>Savings<br></h2><span id="total-savings">₱0.00</span></div>
        <div class="summary-card"><h2>Remaining<br></h2><span id="remaining">₱0.00</span></div>
      </div>

 <div class="tracker-duo">
  <!-- Left Column: Expenses -->
<div class="weekly-tracker-combined" id="expenses-card">
  <!-- Left Segment: Total Expenses -->
  <div class="tracker-segment tracker-left">
    <div class="tracker-header tracker-left-header">
      <div class="header-group">
        <h2>Total Expenses</h2>
        <select class="tracker-filter" id="expenses-filter">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
    <div class="barseg-week" id="expenses-pill-bars"></div>
  </div>

  <!-- Right Segment: Expenses by Category -->
  <div class="tracker-segment tracker-right">
    <div class="tracker-header tracker-right-header">
      <div class="header-group">
        <h2>Expenses by Category</h2>
        <select class="tracker-filter" id="expenses-cat-filter">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="all">All</option>
        </select>
          </div>
      </div>
    <div class="donut-chart-container" id="expenses-donut-container"></div>
  </div>
</div>


  <!-- Right Column: Savings -->
<!-- Right Column: Savings -->
<div class="weekly-tracker-combined" id="savings-card">
  <!-- Left Segment: Total Expenses -->
  <div class="tracker-segment tracker-left">
    <div class="tracker-header tracker-left-header">
      <div class="header-group">
        <h2>Total Savings</h2>
        <select class="tracker-filter" id="savings-filter">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
    <div class="barseg-week" id="savings-pill-bars"></div>
  </div>

  <!-- Right Segment: Expenses by Category -->
  <div class="tracker-segment tracker-right">
    <div class="tracker-header tracker-right-header">
      <div class="header-group">
        <h2>Savings by Category</h2>
        <select class="tracker-filter" id="savings-cat-filter">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="all">All</option>
        </select>
          </div>
      </div>
    <div class="donut-chart-container" id="savings-donut-container"></div>
  </div>
</div>
</div>


    <!-- BOTTOM ROW: Summary + Smart Allocator -->
    <div class="bottom-row">
<div class="weekly-tracker-combined full-row-tracker" id="allowance-card">
  <!-- Single Segment: Total Allowance -->
  <div class="tracker-segment tracker-left">
    <div class="tracker-header tracker-left-header">
      <div class="header-group">
        <h2>Total Allowance</h2>
        <select class="tracker-filter" id="allowance-filter">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
    <div class="allowance-week" id="allowance-pill-bars"></div>
  </div>
</div>

<div class="card-box goal-tracker">
  <div class="logo-text">
    <h3 class="h3-text">Goal Tracker</h3>
  </div>

  <!-- Filter + Per Page Select -->
  <div class="goal-controls">
  <!-- Search Box -->
  <input type="text" id="goal-filter" class="goal-search" placeholder="Search goals..." />

  <!-- Select Entries Limit -->
  <div class="goal-select-group">
    <label for="entries-limit">Show:</label>
    <select id="entries-limit" class="goal-select">
      <option value="10" selected>8</option>
      <option value="25">25</option>
      <option value="50">50</option>
      <option value="100">100</option>
    </select>
  </div>

  <!-- Refresh Button -->
  <button id="goal-refresh-btn" class="goal-refresh-btn">Refresh</button>
</div>

  <!-- Goal Entries -->
  <div id="goal-entries" class="goal-grid" style="margin-top: 1rem;"></div>
</div>

    </div>

  </div>


<script>
function load_summary_totals(filter = "month") {
  const date = new Date().toISOString().split("T")[0];

  const formData = new FormData();
  formData.append("filter", filter); // "month" = current week, "year" = current month, "all" = all time
  formData.append("date", date);

  fetch("load_summary_totals.php", {
    method: "POST",
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) return alert("Error: " + data.error);

      document.getElementById("total-allowance").textContent = `₱${data.summary.total_allowance.toFixed(2)}`;
      document.getElementById("total-expense").textContent = `₱${data.summary.total_expense.toFixed(2)}`;
      document.getElementById("total-savings").textContent = `₱${data.summary.total_savings.toFixed(2)}`;
      document.getElementById("remaining").textContent = `₱${data.summary.remaining.toFixed(2)}`;
    })
    .catch(err => {
      console.error("Summary fetch failed:", err);
      alert("Something went wrong. Please try again.");
    });
}
document.addEventListener("DOMContentLoaded", () => {
  const entriesLimitSelect = document.getElementById("entries-limit");
  const filterInput = document.getElementById("goal-filter");
  const refreshBtn = document.getElementById("goal-refresh-btn");
  const goalContainer = document.getElementById("goal-entries");

  // Store current state
  let allGoals = [];
  let currentLimit = parseInt(entriesLimitSelect.value) || 8;
  let searchQuery = "";
  let limitHistory = {};

  // Fetch and populate goal data
  async function fetchGoals() {
    const formData = new FormData();
    formData.append("filter", "all");
    formData.append("date", new Date().toISOString().split("T")[0]);

    try {
      const res = await fetch("summaries.php", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      allGoals = data.goals || [];
      renderGoals();
    } catch (err) {
      console.error("Fetch failed", err);
    }
  }

  // Render goals with filter and limit
  function renderGoals() {
    const filtered = allGoals.filter(goal =>
      goal.goal_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    goalContainer.innerHTML = "";

    filtered.slice(0, currentLimit).forEach(goal => {
      const saved = Number(goal.saved) || 0;
      const target = Number(goal.target_amount) || 0;
      const progress = Number(goal.progress_percent) || 0;

      const entry = document.createElement("div");
      entry.className = "goal-entry";
      entry.innerHTML = `
        <div class="goal-name">${goal.goal_name}</div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="goal-percentage">${progress.toFixed(2)}%</div>
      `;
      goalContainer.appendChild(entry);
    });
  }

  // Event: Limit Select
  entriesLimitSelect.addEventListener("change", (e) => {
    currentLimit = parseInt(e.target.value);
    limitHistory["all"] = currentLimit;
    renderGoals();
  });

  // Event: Filter input
  filterInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderGoals();
  });

  // Event: Refresh Button
  refreshBtn.addEventListener("click", () => {
    currentLimit = limitHistory["all"] || 8;
    entriesLimitSelect.value = currentLimit;
    filterInput.value = "";
    searchQuery = "";
    fetchGoals();
  });

  // Init
  entriesLimitSelect.value = currentLimit;
  fetchGoals();
});
  // UI references
document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0]; // yyyy-mm-dd

  const trackerConfig = {
    expenses: {
      filterId: "expenses-filter",
      containerId: "expenses-pill-bars",
      type: "expenses_total"
    },
    savings: {
      filterId: "savings-filter",
      containerId: "savings-pill-bars",
      type: "savings_total"
    },
    allowance: {
      filterId: "allowance-filter",
      containerId: "allowance-pill-bars",
      type: "allowance"
    },
    expensesCat: {
      filterId: "expenses-cat-filter",
      containerId: "expenses-donut-container",
      type: "expenses"
    },
    savingsCat: {
      filterId: "savings-cat-filter",
      containerId: "savings-donut-container",
      type: "savings"
    }
  };

  function fetchAndRender(typeKey) {
    const config = trackerConfig[typeKey];
    const filter = document.getElementById(config.filterId).value;

    const formData = new FormData();
    formData.append("filter", filter === "all" ? "all" : (filter === "weekly" ? "month" : "year"));
    formData.append("date", today);

    fetch("summaries.php", {
      method: "POST",
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) return alert(data.error);

      const container = document.getElementById(config.containerId);
      container.innerHTML = "";

      const indexLabels = filter === "weekly"
        ? ["W1", "W2", "W3", "W4"]
        : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      // === 🔶 BAR PILL CHART ===
      if (typeKey === "expenses" || typeKey === "savings" || typeKey === "allowance") {
        let values = data.breakdown[config.type] || [];
        const max = Math.max(...values.map(v => typeof v === 'number' ? v : 0), 1);

        indexLabels.forEach((label, i) => {
          const rawVal = values[i];
          const value = typeof rawVal === "number" ? rawVal : 0;
          const width = (value / max) * 100;
          const fillClass = (typeKey === "savings" || typeKey === "allowance") ? "barseg-sav" : "barseg-exp";

          container.innerHTML += `
            <div class="barseg-item">
              <div class="barseg-label">${label}</div>
              <div class="barseg-bar">
                <div class="barseg-fill ${fillClass}" style="width:${width}%;"></div>
              </div>
              <div class="barseg-label">₱${value.toFixed(2)}</div>
            </div>
          `;
        });
      }

      // === 🍩 DONUT CHART ===
      if (typeKey === "expensesCat" || typeKey === "savingsCat") {
        const breakdown = data.breakdown[config.type] || [];
        const allCategories = {};

        breakdown.forEach(period => {
          if (period && typeof period === "object") {
            for (const [cat, amt] of Object.entries(period)) {
              const val = typeof amt === "number" ? amt : 0;
              allCategories[cat] = (allCategories[cat] || 0) + val;
            }
          }
        });

        const total = Object.values(allCategories).reduce((sum, val) => sum + val, 0);
        if (total === 0) {
          container.innerHTML = `<div class="donut-center-label">No data</div>`;
          return;
        }

        let currentDeg = 0;
        const conicGradient = [];
        const legend = [];
        let colorIndex = 0;

        Object.entries(allCategories).forEach(([cat, amt]) => {
          const val = typeof amt === "number" ? amt : 0;
          const deg = (val / total) * 360;
          const color = getPastelGlassColor(colorIndex++);

          conicGradient.push(`${color} ${currentDeg}deg ${currentDeg + deg}deg`);
          currentDeg += deg;

legend.push(`
  <div class="donut-legend-item">
    <div class="donut-color" style="background:${color};"></div>
    <span class="donut-palette">${cat} (₱${val.toFixed(2)})</span>
  </div>
`);
        });

        container.innerHTML = `
          <div class="donut-ring" style="background: conic-gradient(${conicGradient.join(",")})">
            <div class="donut-center-label">₱${total.toFixed(2)}</div>
          </div>
          <div class="donut-legend">${legend.join("")}</div>
        `;
      }
    })
    .catch(err => {
      console.error("AJAX Error", err);
    });
  }

  // Attach filter listeners and trigger on load
  Object.keys(trackerConfig).forEach(key => {
    const filterElem = document.getElementById(trackerConfig[key].filterId);
    if (filterElem) {
      filterElem.addEventListener("change", () => fetchAndRender(key));
      fetchAndRender(key);
    }
  });

  // 🎨 Pastel glassy blue/pink palette
  function getPastelGlassColor(i) {
  const pastelPalette = [
    "rgba(255, 183, 213, 0.85)",  // cotton pink
    "rgba(170, 200, 255, 0.85)",  // powder blue
    "rgba(203, 153, 255, 0.85)",  // lavender
    "rgba(140, 220, 255, 0.85)",  // baby cyan
    "rgba(255, 200, 250, 0.85)",  // blush pink
    "rgba(173, 173, 255, 0.85)",  // soft indigo
    "rgba(215, 160, 255, 0.85)",  // orchid violet
    "rgba(186, 225, 255, 0.85)",  // ice blue
    "rgba(255, 185, 245, 0.85)",  // bubblegum pink
    "rgba(165, 210, 255, 0.85)"   // frost blue
  ];
  return pastelPalette[i % pastelPalette.length];
}
});

document.addEventListener("DOMContentLoaded", function () {
    load_summary_totals(); // default filter = "month"
  });

  // Optional: Hook dropdown change too
  document.getElementById("summary-filter").addEventListener("change", function () {
    load_summary_totals(this.value);
  });
  setInterval(() => {
  load_summary_totals(document.getElementById("summary-filter").value);

  // Re-fetch other trackers
  ["expenses", "savings", "allowance", "expensesCat", "savingsCat"].forEach(fetchAndRender);
}, 2000);
</script>


</body>
</html>
