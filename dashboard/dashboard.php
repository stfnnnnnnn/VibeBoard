<?php
session_start();

if (!isset($_SESSION['first_name'])) {
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

$first_name = htmlspecialchars($_SESSION['first_name']);
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><?= $first_name ?>’s Home</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=DM+Sans:wght@400;700&family=Caveat:wght@500&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
    }

    html, body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
  height: 100vh;
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 12s ease infinite;
  color: #333;
}

    @keyframes gradientFlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    body {
      padding: 5px 5% 40px;
      overflow-x: hidden;
    }

    h1 {
      font-size: 4rem;
      margin-bottom: 25px;
      background: linear-gradient(to right, #f2a7c0, #74bcd9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .widget, .card {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(12px);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.15);
      transition: all 0.3s ease;
    }

    .widget:hover, .card:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 25px rgba(0,0,0,0.2);
    }

  .quote {
  font-family: 'DM Sans', sans-serif;
  font-size: 16px;
  font-style: normal;
  line-height: 1.6;
  color: #444;
  text-align: left;
  padding: 6px 12px;
}


/* Force quote + weather side by side */
.two-cols {
  display: flex;
  gap: 20px;
  align-items: stretch;
}

/* Each widget gets 50% width */
.quote-widget, .weather-widget {
  flex: 1;
  min-width: 0;
}

/* Ensure weather content is wrapped and doesn't stretch height */
#weather-icon {
  width: 36px; /* was 48px */
  height: 36px;
  object-fit: contain;
}

.weather-widget {
  font-size: 0.95rem; /* slightly smaller */
  gap: 8px; /* slightly tighter layout */
}

#weather-details span {
  font-size: 1.1rem !important; /* temp text smaller */
}

#weather-location span {
  font-size: 0.8rem !important;
}

/* Stack on mobile */
@media (max-width: 768px) {
  .two-cols {
    flex-direction: column;
  }
}




.tiles {
  width: 100%;
  overflow-x: auto;
  display: flex;
  justify-content: center; /* centers tiles-wrapper inside tiles */
  padding: 20px 0;
}

.tiles-wrapper {
  display: flex;
  gap: 20px;
  justify-content: center;
}

.card {
  flex-shrink: 0;
  width: 400px;
  height: 300px;
  border-radius: 20px;
  padding: 20px;
  text-align: center;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.card-link {
  text-decoration: none;
  color: inherit;
  display: inline-block;
}

.card-link .card {
  cursor: pointer;
}

.card:hover {
  transform: translateY(-10px);
  box-shadow: 0 15px 35px rgba(0,0,0,0.25);
}

.card img {
  width: 100%;
  height: 220px;
  object-fit: cover;
  border-radius: 14px;
  margin-bottom: 10px;
  image-rendering: smooth;
}
    footer {
      margin-top: 60px;
      text-align: center;
      color: #444;
      font-size: 0.9rem;
    }

    @media (max-width: 768px) {
      .tiles {
        flex-direction: column;
        align-items: center;
      }

      .card {
        width: 90%;
      }

      h1 {
        font-size: 2.2rem;
        text-align: center;
      }
    }

        .pill-logout {
      background: linear-gradient(to right, #f2a7c0, #74bcd9);
      color: rgba(255, 255, 255, 0.97);
      border: 2px solid #4dabf5;
      border-radius: 20px;
      border-color: #4dabf5;                 /* highlight border */
      box-shadow: 0 4px 12px rgba(77, 171, 245, 0.3); /* optional glow */
      padding: 8px 16px;
      font-weight: 700;
      font-size: 1.0rem;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      border: 1px solid #ddd;
      transition: background 0.3s;
    }

      .header-row {
    display: flex;
    align-items: center;       
    justify-content: space-between;
    gap: 20px;                
    flex-wrap: wrap;          
  }
  </style>
</head>
<body>
  <div class="header-row">
  <h1><?= $first_name ?>’s Home</h1>
  <form action="logout.php" method="post" style="margin: 0;">
  <button type="submit" class="pill-logout">Sign-Out</button>
</form>
  </div>
  <div class="grid two-cols">
  <!-- Quote Widget -->
  <div class="widget quote-widget">
    <p class="quote" id="quote-text">
      Loading inspirational quote...
    </p>
  </div>

  <!-- Weather Widget -->
  <div class="widget weather-widget" id="weather-widget">
    <div id="weather-location"><strong>Detecting...</strong></div>
    <div><img id="weather-icon" src="" alt="Weather Icon" style="display: none;"></div>
    <div id="weather-main" style="display: flex; align-items: center; gap: 10px;">
  <img id="weather-icon" src="" alt="Weather Icon" style="display: none;">
  <span id="weather-temp" style="font-size: 1.3rem;"></span>
  <span id="weather-condition" style="font-size: 0.95rem; color: #555;"></span>
</div>

<div id="weather-extra" style="display: flex; justify-content: space-between; margin-top: 12px;">
  <span id="weather-feelslike">Feels like: -- °C</span>
  <span id="weather-humidity">Humidity: --%</span>
  <span id="weather-wind">Wind: -- kph</span>
  <span id="weather-uv">UV Index: --</span>
</div>
  </div>
</div>

<div class="tiles">
  <div class="tiles-wrapper">
  <!-- Study Pulse -->
  <a href="/VibeBoard/studypulse/studypulse.php" class="card-link">
    <div class="card">
      <img src="studypulse.png" alt="Study Pulse">
    </div>
  </a>

  <!-- Finance Tracker -->
  <a href="/VibeBoard/financetracker/financedashboard.php" class="card-link">
    <div class="card">
      <img src="financetracker.png" alt="Finance">
    </div>
  </a>

  <!-- Habit Tracker -->
  <a href="/VibeBoard/habittracker/habittracker.php" class="card-link">
    <div class="card">
      <img src="habittracker.png" alt="Habits">
    </div>
  </a>
</div>
</div>




  <footer>
    &copy; <?= date('Y') ?> VibeBoard Dashboard
  </footer>

<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
<script>
  // Ask user for location or prompt for city
    function getWeatherByCity(city) {
  $.getJSON(`https://api.weatherapi.com/v1/current.json?key=fc4d2d021d814bb6854121406251307&q=${city}`, function(data) {
    // Location
    $('#weather-location').html(`<strong>${data.location.name.toUpperCase()}</strong><br><span style="font-size: 0.9rem;">${data.location.region}, ${data.location.country}</span>`);
    
    // Main row (icon + temp + condition)
    $('#weather-icon').attr('src', data.current.condition.icon).show();
    $('#weather-temp').text(`${data.current.temp_c} °C`);
    $('#weather-condition').text(data.current.condition.text);

    // Extra details
    $('#weather-feelslike').text(`Feels like: ${data.current.feelslike_c} °C`);
    $('#weather-humidity').text(`Humidity: ${data.current.humidity}%`);
    $('#weather-wind').text(`Wind: ${data.current.wind_kph} kph`);
    $('#weather-uv').text(`UV Index: ${data.current.uv}`);
  }).fail(function() {
    $('#weather-location').html('<strong>Location error</strong>');
    $('#weather-temp').text(`-- °C`);
    $('#weather-condition').text(`Unknown`);
    $('#weather-icon').hide();
    $('#weather-feelslike').text(`Feels like: -- °C`);
    $('#weather-humidity').text(`Humidity: --%`);
    $('#weather-wind').text(`Wind: -- kph`);
    $('#weather-uv').text(`UV Index: --`);
  });
}


  const savedCity = localStorage.getItem('weather_city');
if (savedCity) {
  getWeatherByCity(savedCity);
} else {
  const city = prompt("Enter your city for weather updates:");
  if (city) {
    localStorage.setItem('weather_city', city);
    getWeatherByCity(city);
  }
}


  // Try geolocation first
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(function(position) {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      getWeatherByCity(`${lat},${lon}`);
    }, function(error) {
      // Fallback prompt
      const city = prompt("Enter your city for weather updates:");
      if (city) getWeatherByCity(city);
      else $('#weather-details').text("No city provided.");
    });
  } else {
    // If geolocation is not available
    const city = prompt("Enter your city for weather updates:");
    if (city) getWeatherByCity(city);
    else $('#weather-details').text("No city provided.");
  }

  // Quote API — no changes here
  $.ajax({
    method: 'GET',
    url: 'https://api.api-ninjas.com/v1/quotes',
    headers: { 'X-Api-Key': 'WcE16OTZDL6zHx+aTQqnZg==Q70bLxVPq9TANWFi' },
    contentType: 'application/json',
    success: function(result) {
      if (result.length > 0) {
        const quote = result[0];
        $('#quote-text').html(
          `<span class="highlight">“${quote.quote}”</span><br>— ${quote.author}`
        );
      } else {
        $('#quote-text').text('No quote available at the moment.');
      }
    },
    error: function(jqXHR) {
      console.error('Error: ', jqXHR.responseText);
      $('#quote-text').text('Failed to load quote.');
    }
  });
</script>


</body>
</html>
