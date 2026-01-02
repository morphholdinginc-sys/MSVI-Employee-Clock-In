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
      rateType: r.fields.RateType || ''
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
    const today = new Date().toISOString().split('T')[0];
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
   * Create a new attendance record
   */
  async function createAttendanceRecord(employeeId, date, actionType, timeValue) {
    const fields = {
      EmployeeId: employeeId,
      Date: date,
      [actionType]: timeValue
    };
    
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
   */
  async function updateAttendanceRecord(recordId, actionType, timeValue) {
    const fields = {
      [actionType]: timeValue
    };
    
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
