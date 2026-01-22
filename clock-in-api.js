/**
 * clock-in-api.js
 * 
 * Attendance API module for the Clock In module
 * Handles all Airtable API calls for attendance records
 */

(function() {
  'use strict';

  // Use centralized config from airtable-config.js
  const getConfig = () => ({
    API_KEY: AIRTABLE_CONFIG.API_KEY,
    BASE_ID: AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES,
    ATTENDANCE_TABLE: AIRTABLE_CONFIG.TABLES.ATTENDANCES,
    EMPLOYEE_TABLE: AIRTABLE_CONFIG.TABLES.EMPLOYEE_DIRECTORY
  });

  function getAttendanceTableUrl() {
    const config = getConfig();
    return `https://api.airtable.com/v0/${config.BASE_ID}/${encodeURIComponent(config.ATTENDANCE_TABLE)}`;
  }

  function getEmployeeTableUrl() {
    const config = getConfig();
    return `https://api.airtable.com/v0/${config.BASE_ID}/${encodeURIComponent(config.EMPLOYEE_TABLE)}`;
  }

  function headers() {
    return {
      'Authorization': `Bearer ${getConfig().API_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch all employees for autocomplete/search
   */
  async function getAllEmployees() {
    let records = [];
    let offset = undefined;
    
    do {
      const url = new URL(getEmployeeTableUrl());
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('view', 'Grid view');
      if (offset) url.searchParams.set('offset', offset);
      
      const res = await fetch(url, { headers: headers() });
      const data = await res.json();
      
      if (data.records) {
        records = records.concat(data.records);
      }
      offset = data.offset;
    } while (offset);
    
    return records.map(r => ({
      id: r.id,
      employeeId: r.fields.EmployeeId || r.fields.Id || r.id,
      firstName: r.fields.FirstName || '',
      lastName: r.fields.LastName || '',
      suffix: r.fields.Suffix || '',
      fullName: `${r.fields.FirstName || ''} ${r.fields.LastName || ''}${r.fields.Suffix ? ' ' + r.fields.Suffix : ''}`.trim(),
      department: r.fields.Department || '',
      status: r.fields.Status || 'Active',
      standardWorkweekHours: Number(r.fields.StandardWorkweekHours) || 40,
      rateType: r.fields.RateType || '',
      coreWorkingHours: r.fields.CoreWorkingHours || ''
    })).filter(e => e.status === 'Active');
  }

  /**
   * Get attendance records for a specific employee
   * @param {string} employeeId - The employee ID to search for
   * @param {string} fromDate - Optional start date (YYYY-MM-DD)
   * @param {string} toDate - Optional end date (YYYY-MM-DD)
   */
  async function getAttendanceByEmployee(employeeId, fromDate = null, toDate = null) {
    let records = [];
    let offset = undefined;
    
    // Build filter formula
    let filterParts = [`{EmployeeId}='${employeeId}'`];
    
    if (fromDate) {
      filterParts.push(`IS_AFTER({Date}, DATEADD('${fromDate}', -1, 'days'))`);
    }
    if (toDate) {
      filterParts.push(`IS_BEFORE({Date}, DATEADD('${toDate}', 1, 'days'))`);
    }
    
    const filterFormula = filterParts.length > 1 
      ? `AND(${filterParts.join(', ')})` 
      : filterParts[0];
    
    do {
      const url = new URL(getAttendanceTableUrl());
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('filterByFormula', filterFormula);
      url.searchParams.set('sort[0][field]', 'Date');
      url.searchParams.set('sort[0][direction]', 'desc');
      if (offset) url.searchParams.set('offset', offset);
      
      const res = await fetch(url, { headers: headers() });
      const data = await res.json();
      
      if (data.records) {
        records = records.concat(data.records);
      }
      offset = data.offset;
    } while (offset);
    
    return records.map(mapRecord).filter(r => r !== null);
  }

  /**
   * Get today's attendance for all employees
   */
  async function getTodayAttendance() {
    // Use local date instead of UTC to handle timezone correctly
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    
    const filterFormula = `DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${today}'`;
    
    let records = [];
    let offset = undefined;
    
    do {
      const url = new URL(getAttendanceTableUrl());
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('filterByFormula', filterFormula);
      url.searchParams.set('sort[0][field]', 'Date');
      url.searchParams.set('sort[0][direction]', 'desc');
      if (offset) url.searchParams.set('offset', offset);
      
      const res = await fetch(url, { headers: headers() });
      const data = await res.json();
      
      if (data.records) {
        records = records.concat(data.records);
      }
      offset = data.offset;
    } while (offset);
    
    return records;
  }

  /**
   * Find today's attendance record for a specific employee
   */
  async function findTodayRecord(employeeId, date) {
    const filterFormula = `AND({EmployeeId}='${employeeId}', DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${date}')`;
    
    const url = new URL(getAttendanceTableUrl());
    url.searchParams.set('filterByFormula', filterFormula);
    url.searchParams.set('maxRecords', '1');
    
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    
    return data.records && data.records.length > 0 ? data.records[0] : null;
  }

  /**
   * Parse time string (HH:MM or HH:MM AM/PM) to minutes since midnight
   * @param {string} timeStr - Time string
   * @returns {number|null} - Minutes since midnight or null if invalid
   */
  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    
    // Handle 12-hour format (e.g., "07:36 AM")
    const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      let hours = parseInt(match12[1], 10);
      const minutes = parseInt(match12[2], 10);
      const period = match12[3].toUpperCase();
      
      if (period === 'AM' && hours === 12) hours = 0;
      else if (period === 'PM' && hours !== 12) hours += 12;
      
      return hours * 60 + minutes;
    }
    
    // Handle 24-hour format (e.g., "07:36")
    const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const hours = parseInt(match24[1], 10);
      const minutes = parseInt(match24[2], 10);
      return hours * 60 + minutes;
    }
    
    return null;
  }

  /**
   * Calculate total hours worked from time entries
   * @param {object} record - Object with TimeInAM, TimeOutAM, TimeInPM, TimeOutPM
   * @returns {number} - Total hours worked
   */
  function calculateTotalHours(record) {
    let totalMinutes = 0;
    
    // Calculate AM hours
    const inAM = parseTimeToMinutes(record.TimeInAM);
    const outAM = parseTimeToMinutes(record.TimeOutAM);
    if (inAM !== null && outAM !== null && outAM > inAM) {
      totalMinutes += (outAM - inAM);
    }
    
    // Calculate PM hours
    const inPM = parseTimeToMinutes(record.TimeInPM);
    const outPM = parseTimeToMinutes(record.TimeOutPM);
    if (inPM !== null && outPM !== null && outPM > inPM) {
      totalMinutes += (outPM - inPM);
    }
    
    return totalMinutes / 60;
  }

  /**
   * Get employee data by ID for overtime calculations
   * @param {string} employeeId - Employee ID
   * @returns {object|null} - Employee data
   */
  async function getEmployeeById(employeeId) {
    const url = new URL(getEmployeeTableUrl());
    url.searchParams.set('filterByFormula', `{EmployeeId}='${employeeId}'`);
    url.searchParams.set('maxRecords', '1');
    
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    
    if (data.records && data.records.length > 0) {
      const r = data.records[0];
      return {
        baseSalary: Number(r.fields.BaseSalary) || 0,
        standardWorkweekHours: Number(r.fields.StandardWorkweekHours) || 40,
        rateType: r.fields.RateType || '',
        employmentType: r.fields.EmploymentType || r.fields.Type || ''
      };
    }
    return null;
  }

  /**
   * Check if employee is fixed rate (no overtime pay)
   * @param {object} emp - Employee data
   * @returns {boolean} - True if fixed rate
   */
  function isFixedRate(emp) {
    if (!emp) return false;
    const rateType = (emp.rateType || '').toLowerCase();
    const empType = (emp.employmentType || '').toLowerCase();
    return rateType.includes('fixed') || 
           rateType.includes('monthly') || 
           rateType.includes('salary') || 
           empType.includes('fixed');
  }

  /**
   * Calculate hourly rate from employee data
   * @param {object} emp - Employee data
   * @returns {number} - Hourly rate
   */
  function calculateHourlyRate(emp) {
    const base = emp?.baseSalary || 0;
    if (!base) return 0;
    const standard = emp?.standardWorkweekHours || 40;
    const daily = standard / 7;
    const dailyRate = base / 30;
    return dailyRate / daily;
  }

  /**
   * Calculate overtime fields based on total hours and employee data
   * Handles FIXED vs Time-based rate types:
   * - Fixed Rate: OvertimeHours = 0, OverTimePay = 0 (regardless of hours worked)
   * - Time-based: Calculate overtime for hours exceeding daily standard
   * 
   * @param {number} totalHours - Total hours worked
   * @param {string} employeeId - Employee ID for fetching rate data
   * @returns {object} - { TotalHoursWorked, OvertimeHours, OverTimePay }
   */
  async function calculateOvertimeFields(totalHours, employeeId) {
    const result = {
      TotalHoursWorked: Math.round(totalHours * 100) / 100,
      OvertimeHours: 0,
      OverTimePay: 0
    };
    
    try {
      const employee = await getEmployeeById(employeeId);
      
      // Check if employee is Fixed rate type
      const isFixed = isFixedRate(employee);
      
      // Fixed rate employees: no overtime hours or pay
      // This handles:
      // - "Fix with 10hrs with actual of 9hrs" - still no OT
      // - "Fix with 8hrs of work" - no OT
      // - "Fix with 8hrs work only" - no OT
      if (isFixed) {
        // For fixed rate, only store TotalHoursWorked
        // OvertimeHours and OverTimePay remain 0
        return result;
      }
      
      // Time-based employees: calculate overtime
      const standardDailyHours = employee ? (employee.standardWorkweekHours / 7) : 8;
      
      // Calculate overtime hours (only hours beyond daily standard)
      const overtimeHours = Math.max(0, totalHours - standardDailyHours);
      result.OvertimeHours = Math.round(overtimeHours * 100) / 100;
      
      // Calculate overtime pay for time-based employees
      if (employee && employee.baseSalary > 0 && overtimeHours > 0) {
        const hourlyRate = calculateHourlyRate(employee);
        result.OverTimePay = Math.round(overtimeHours * hourlyRate * 1.25 * 100) / 100;
      }
    } catch (err) {
      console.error('[Clock-In API] Error calculating overtime:', err);
      // On error, default to storing only total hours (safe default)
      // Don't calculate overtime without employee data
    }
    
    return result;
  }

  /**
   * Create a new attendance record
   */
  async function createAttendanceRecord(employeeId, date, actionType, timeValue) {
    const fields = {
      EmployeeId: employeeId,
      Date: date,
      [actionType]: timeValue
    };
    
    // If clocking out, calculate total hours (for a new record, this is rare but handle it)
    if (actionType === 'TimeOutAM' || actionType === 'TimeOutPM') {
      const record = { [actionType]: timeValue };
      const totalHours = calculateTotalHours(record);
      if (totalHours > 0) {
        const overtimeFields = await calculateOvertimeFields(totalHours, employeeId);
        Object.assign(fields, overtimeFields);
      }
    }
    
    const response = await fetch(getAttendanceTableUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ fields })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create record: ${error}`);
    }
    
    return await response.json();
  }

  /**
   * Update an existing attendance record
   * @param {string} recordId - Airtable record ID
   * @param {string} actionType - Field to update (TimeInAM, TimeOutAM, TimeInPM, TimeOutPM)
   * @param {string} timeValue - Time value
   * @param {object} existingFields - Optional existing record fields for calculation
   */
  async function updateAttendanceRecord(recordId, actionType, timeValue, existingFields = null) {
    const fields = {
      [actionType]: timeValue
    };
    
    // If clocking out, calculate total hours
    if (actionType === 'TimeOutAM' || actionType === 'TimeOutPM') {
      // If we don't have existing fields, fetch them
      let currentRecord = existingFields;
      if (!currentRecord) {
        try {
          const res = await fetch(`${getAttendanceTableUrl()}/${recordId}`, { headers: headers() });
          const data = await res.json();
          currentRecord = data.fields || {};
        } catch (err) {
          console.error('[Clock-In API] Error fetching record for calculation:', err);
          currentRecord = {};
        }
      }
      
      // Build complete record with new time value
      const fullRecord = {
        TimeInAM: currentRecord.TimeInAM || null,
        TimeOutAM: currentRecord.TimeOutAM || null,
        TimeInPM: currentRecord.TimeInPM || null,
        TimeOutPM: currentRecord.TimeOutPM || null,
        [actionType]: timeValue
      };
      
      const totalHours = calculateTotalHours(fullRecord);
      if (totalHours > 0) {
        const employeeId = currentRecord.EmployeeId;
        const overtimeFields = await calculateOvertimeFields(totalHours, employeeId);
        Object.assign(fields, overtimeFields);
      }
    }
    
    const response = await fetch(`${getAttendanceTableUrl()}/${recordId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ fields })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update record: ${error}`);
    }
    
    return await response.json();
  }

  /**
   * Map Airtable record to JS object
   */
  function mapRecord(record) {
    if (!record || !record.fields) return null;
    
    return {
      id: record.id,
      employeeId: record.fields.EmployeeId,
      date: record.fields.Date,
      timeInAM: record.fields.TimeInAM || null,
      timeOutAM: record.fields.TimeOutAM || null,
      timeInPM: record.fields.TimeInPM || null,
      timeOutPM: record.fields.TimeOutPM || null,
      totalHoursWorked: record.fields.TotalHoursWorked || 0,
      overtimeHours: record.fields.OvertimeHours || 0,
      leaveType: record.fields.LeaveType || '',
      remarks: record.fields.Remarks || ''
    };
  }

  // ============================================
  // WINDOW EXPORTS
  // ============================================
  window.ClockInAPI = {
    getAllEmployees,
    getAttendanceByEmployee,
    getTodayAttendance,
    findTodayRecord,
    createAttendanceRecord,
    updateAttendanceRecord
  };

})();
