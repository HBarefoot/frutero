const path = require('path');

module.exports = {
  FAN_PIN: 18,
  LIGHT_PIN: 17,
  DHT22_PIN: 4,
  GPIO_CHIP: 0,

  // Relay polarity — set true if the device's AC line is wired through the
  // relay's NC (normally-closed) contact, so power flows when the coil is
  // de-energized. If false (default), wiring is NO (normally-open): pin LOW
  // energizes the coil and closes the circuit.
  FAN_INVERTED: false,
  LIGHT_INVERTED: true,

  SENSOR_AVAILABLE: true,
  SENSOR_READ_INTERVAL: 60,

  FAN_ON_DURATION: 60,
  FAN_CYCLE_INTERVAL: 30,

  LIGHT_ON_TIME: '0 6 * * *',
  LIGHT_OFF_TIME: '0 18 * * *',

  TEMP_MIN: 60,
  TEMP_MAX: 80,
  HUMID_MIN: 75,
  HUMID_MAX: 95,

  PORT: 3000,

  DB_PATH: path.join(__dirname, 'mushroom.db'),

  ALERT_DEBOUNCE_MS: 5 * 60 * 1000,
  WARNING_MARGIN: 0.05,

  SPECIES_PRESETS: {
    oyster: {
      name: 'Blue Oyster',
      temp_min: 55, temp_max: 75,
      humid_min: 80, humid_max: 95,
      light_hours: 12,
      fan_interval: 30,
    },
    lions_mane: {
      name: "Lion's Mane",
      temp_min: 60, temp_max: 75,
      humid_min: 85, humid_max: 95,
      light_hours: 12,
      fan_interval: 20,
    },
    shiitake: {
      name: 'Shiitake',
      temp_min: 60, temp_max: 80,
      humid_min: 80, humid_max: 90,
      light_hours: 12,
      fan_interval: 30,
    },
  },
};
