// Fake FSAE signal library + deterministic waveform synthesis.
// Everything renders from seeded PRNG so graphs are stable across renders.

(function () {
  const GROUPS = [
    { id: 'pwr', name: 'POWERTRAIN', color: '#e0b066', signals: [
      ['Inverter_RPM', 'rpm', 0, 8000, 'line'],
      ['Inverter_Torque', 'Nm', -50, 220, 'line'],
      ['Inverter_DC_Voltage', 'V', 200, 410, 'line'],
      ['Inverter_DC_Current', 'A', -80, 260, 'line'],
      ['Motor_Temperature', '°C', 20, 95, 'slow'],
      ['IGBT_Temperature', '°C', 20, 85, 'slow'],
      ['Motor_Phase_U', 'A', -180, 180, 'ac'],
      ['Motor_Phase_V', 'A', -180, 180, 'ac'],
      ['Motor_Phase_W', 'A', -180, 180, 'ac'],
      ['Gear_Position', '', 0, 4, 'step'],
      ['Driveshaft_Torque', 'Nm', -80, 240, 'line'],
      ['Launch_State', '', 0, 1, 'bool'],
    ]},
    { id: 'hv', name: 'HIGH VOLTAGE', color: '#e06c6c', signals: [
      ['HV_Battery_Voltage', 'V', 280, 410, 'line'],
      ['HV_Battery_Current', 'A', -60, 280, 'line'],
      ['HV_Battery_SOC', '%', 0, 100, 'slow'],
      ['HV_Cell_Min_V', 'V', 3.0, 4.2, 'slow'],
      ['HV_Cell_Max_V', 'V', 3.0, 4.2, 'slow'],
      ['HV_Cell_Avg_V', 'V', 3.0, 4.2, 'slow'],
      ['HV_Pack_Temp_Min', '°C', 20, 55, 'slow'],
      ['HV_Pack_Temp_Max', '°C', 20, 65, 'slow'],
      ['HV_Pack_Temp_Avg', '°C', 20, 60, 'slow'],
      ['AIR_Plus', '', 0, 1, 'bool'],
      ['AIR_Minus', '', 0, 1, 'bool'],
      ['Precharge_State', '', 0, 1, 'bool'],
      ['IMD_Status', '', 0, 1, 'bool'],
      ['BMS_Fault_Code', '', 0, 15, 'step'],
    ]},
    { id: 'th', name: 'THERMAL', color: '#e08a5a', signals: [
      ['Coolant_Temp_In', '°C', 20, 90, 'slow'],
      ['Coolant_Temp_Out', '°C', 20, 95, 'slow'],
      ['Coolant_Flow_Rate', 'L/min', 0, 25, 'line'],
      ['Coolant_Pressure', 'kPa', 80, 260, 'line'],
      ['Radiator_Fan_Duty', '%', 0, 100, 'line'],
      ['Pump_Duty', '%', 0, 100, 'line'],
      ['Ambient_Temp', '°C', 15, 35, 'slow'],
      ['Cabin_Temp', '°C', 20, 55, 'slow'],
      ['Accumulator_Fan_1', '%', 0, 100, 'line'],
      ['Accumulator_Fan_2', '%', 0, 100, 'line'],
    ]},
    { id: 'sus', name: 'SUSPENSION', color: '#8ba6df', signals: [
      ['Damper_Pos_FL', 'mm', -30, 30, 'line'],
      ['Damper_Pos_FR', 'mm', -30, 30, 'line'],
      ['Damper_Pos_RL', 'mm', -30, 30, 'line'],
      ['Damper_Pos_RR', 'mm', -30, 30, 'line'],
      ['Damper_Vel_FL', 'mm/s', -800, 800, 'ac'],
      ['Damper_Vel_FR', 'mm/s', -800, 800, 'ac'],
      ['Damper_Vel_RL', 'mm/s', -800, 800, 'ac'],
      ['Damper_Vel_RR', 'mm/s', -800, 800, 'ac'],
      ['Wheel_Speed_FL', 'km/h', 0, 130, 'line'],
      ['Wheel_Speed_FR', 'km/h', 0, 130, 'line'],
      ['Wheel_Speed_RL', 'km/h', 0, 130, 'line'],
      ['Wheel_Speed_RR', 'km/h', 0, 130, 'line'],
      ['Steering_Angle', '°', -140, 140, 'line'],
      ['Steering_Torque', 'Nm', -12, 12, 'line'],
    ]},
    { id: 'tire', name: 'TIRES', color: '#6cbfb8', signals: [
      ['Tire_Temp_FL_Inner', '°C', 40, 110, 'slow'],
      ['Tire_Temp_FL_Middle', '°C', 40, 110, 'slow'],
      ['Tire_Temp_FL_Outer', '°C', 40, 110, 'slow'],
      ['Tire_Temp_FR_Inner', '°C', 40, 110, 'slow'],
      ['Tire_Temp_FR_Middle', '°C', 40, 110, 'slow'],
      ['Tire_Temp_FR_Outer', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RL_Inner', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RL_Middle', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RL_Outer', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RR_Inner', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RR_Middle', '°C', 40, 110, 'slow'],
      ['Tire_Temp_RR_Outer', '°C', 40, 110, 'slow'],
      ['Tire_Pressure_FL', 'kPa', 70, 120, 'slow'],
      ['Tire_Pressure_FR', 'kPa', 70, 120, 'slow'],
      ['Tire_Pressure_RL', 'kPa', 70, 120, 'slow'],
      ['Tire_Pressure_RR', 'kPa', 70, 120, 'slow'],
    ]},
    { id: 'imu', name: 'VEHICLE DYNAMICS', color: '#a78bfa', signals: [
      ['Accel_Longitudinal', 'g', -2.2, 2.2, 'ac'],
      ['Accel_Lateral', 'g', -2.4, 2.4, 'ac'],
      ['Accel_Vertical', 'g', -1.5, 3.0, 'ac'],
      ['Yaw_Rate', '°/s', -80, 80, 'ac'],
      ['Pitch_Rate', '°/s', -60, 60, 'ac'],
      ['Roll_Rate', '°/s', -60, 60, 'ac'],
      ['Roll_Angle', '°', -4, 4, 'line'],
      ['Pitch_Angle', '°', -3, 3, 'line'],
      ['Vehicle_Speed', 'km/h', 0, 130, 'line'],
      ['Slip_Angle_Front', '°', -10, 10, 'ac'],
      ['Slip_Angle_Rear', '°', -12, 12, 'ac'],
    ]},
    { id: 'brk', name: 'BRAKES', color: '#d880a0', signals: [
      ['Brake_Pressure_Front', 'bar', 0, 90, 'line'],
      ['Brake_Pressure_Rear', 'bar', 0, 70, 'line'],
      ['Brake_Bias', '%', 40, 70, 'slow'],
      ['Brake_Temp_FL', '°C', 40, 420, 'slow'],
      ['Brake_Temp_FR', '°C', 40, 420, 'slow'],
      ['Brake_Temp_RL', '°C', 40, 380, 'slow'],
      ['Brake_Temp_RR', '°C', 40, 380, 'slow'],
    ]},
    { id: 'drv', name: 'DRIVER INPUT', color: '#b084e8', signals: [
      ['APPS1_Throttle', '%', 0, 100, 'line'],
      ['APPS2_Throttle', '%', 0, 100, 'line'],
      ['Brake_Pedal_Front', '%', 0, 100, 'line'],
      ['Brake_Pedal_Rear', '%', 0, 100, 'line'],
      ['Clutch_Position', '%', 0, 100, 'line'],
      ['Ready_To_Drive', '', 0, 1, 'bool'],
      ['TC_Setting', '', 0, 10, 'step'],
      ['Regen_Setting', '', 0, 10, 'step'],
      ['Power_Map', '', 0, 4, 'step'],
    ]},
    { id: 'aer', name: 'AERO', color: '#88c9a7', signals: [
      ['Front_Wing_Load', 'N', 0, 520, 'line'],
      ['Rear_Wing_Load', 'N', 0, 780, 'line'],
      ['Pitot_Static_Pressure', 'Pa', -200, 1800, 'line'],
      ['Ride_Height_Front', 'mm', 20, 60, 'line'],
      ['Ride_Height_Rear', 'mm', 30, 70, 'line'],
    ]},
    { id: 'gps', name: 'GPS', color: '#e0b866', signals: [
      ['GPS_Latitude', '°', 34.00, 34.05, 'slow'],
      ['GPS_Longitude', '°', -117.82, -117.78, 'slow'],
      ['GPS_Altitude', 'm', 320, 360, 'slow'],
      ['GPS_Speed', 'km/h', 0, 130, 'line'],
      ['GPS_Heading', '°', 0, 360, 'line'],
      ['GPS_Satellites', '', 4, 16, 'step'],
      ['GPS_Fix_Quality', '', 0, 3, 'step'],
      ['Lap_Number', '', 0, 25, 'step'],
      ['Lap_Distance', 'm', 0, 1240, 'line'],
      ['Sector', '', 1, 3, 'step'],
    ]},
    { id: 'ecu', name: 'VCU / ECU', color: '#a0a6ae', signals: [
      ['VCU_State', '', 0, 5, 'step'],
      ['VCU_Loop_Time', 'ms', 0.5, 3.2, 'line'],
      ['VCU_Fault_Flags', '', 0, 255, 'step'],
      ['CAN_Bus_Load_1', '%', 0, 60, 'line'],
      ['CAN_Bus_Load_2', '%', 0, 60, 'line'],
      ['CAN_Bus_Errors', '', 0, 12, 'step'],
      ['12V_Bus_Voltage', 'V', 11.5, 14.2, 'line'],
      ['12V_Bus_Current', 'A', 0, 24, 'line'],
      ['LV_Battery_SOC', '%', 0, 100, 'slow'],
      ['System_Uptime', 's', 0, 3600, 'line'],
    ]},
  ];

  // Deterministic hash → seeded PRNG
  function hash32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build flat list
  const ALL = [];
  for (const g of GROUPS) {
    for (const [name, unit, min, max, shape] of g.signals) {
      ALL.push({
        id: name,
        name,
        unit,
        min,
        max,
        shape,
        group: g.id,
        groupName: g.name,
        color: g.color,
      });
    }
  }

  // Sample a signal at t in [0, 1] (normalized session time). N points.
  function sampleSignal(sig, t0, t1, n) {
    const seed = hash32(sig.name);
    const rng = mulberry32(seed);
    const { min, max, shape } = sig;
    // Base params per signal
    const freq1 = 0.8 + rng() * 2.5;
    const freq2 = 3 + rng() * 8;
    const phase = rng() * Math.PI * 2;
    const mid = (min + max) / 2;
    const span = (max - min);

    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * (i / (n - 1));
      // driving profile: pseudo-lap envelope
      const lap = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.2 + phase);
      const throttle = Math.max(0, Math.sin(t * Math.PI * 2 * 1.5 + 0.5) * 0.7 + 0.3);
      let v;
      switch (shape) {
        case 'ac': {
          v = mid + Math.sin(t * Math.PI * 2 * freq2 + phase) * span * 0.4
            + Math.sin(t * Math.PI * 2 * freq1) * span * 0.2
            + (rng() - 0.5) * span * 0.04;
          break;
        }
        case 'slow': {
          // slow thermal-like rise with noise
          const warm = Math.min(1, t * 1.4 + 0.2);
          v = min + span * warm * (0.65 + 0.25 * lap) + (rng() - 0.5) * span * 0.02;
          break;
        }
        case 'bool': {
          v = t > 0.05 ? 1 : 0;
          if (t > 0.1 && rng() < 0.002) v = 1 - v;
          break;
        }
        case 'step': {
          v = Math.floor(min + span * (0.2 + 0.8 * throttle));
          break;
        }
        default: { // 'line'
          v = mid + (throttle - 0.5) * span * 0.9
            + Math.sin(t * Math.PI * 2 * freq1 + phase) * span * 0.12
            + (rng() - 0.5) * span * 0.03;
        }
      }
      v = Math.max(min - span * 0.05, Math.min(max + span * 0.05, v));
      out[i] = v;
    }
    return out;
  }

  function byId(id) { return ALL.find((s) => s.id === id); }

  window.SIGNALS = {
    GROUPS,
    ALL,
    byId,
    sampleSignal,
  };
})();
