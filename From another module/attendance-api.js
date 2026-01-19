// Attendance API module for Airtable
// Maps SQL table fields to Airtable fields

// Wrap in IIFE to prevent variable conflicts
(function() {
'use strict';

// Use centralized config from airtable-config.js (must be loaded before this script)
const AIRTABLE_API_KEY = AIRTABLE_CONFIG.API_KEY;
const BASE_ID = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
const ATTENDANCE_TABLE = AIRTABLE_CONFIG.TABLES.ATTENDANCES;

function getAttendanceTableUrl() {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ATTENDANCE_TABLE)}`;
}

// Field mapping (SQL → Airtable) using PascalCase to match your schema
// Id: Airtable record id
// EmployeeId
// Date
// TimeInAM
// TimeOutAM
// TimeInPM
// TimeOutPM
// TotalHoursWorked
// OvertimeHours
// OverTimePay
// IsDoublePay
// Remarks


function headers() {
  return {
    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json'
  };
}

// Fetch all attendance records (paginated)

async function getAll(params = {}) {
  let records = [];
  let offset = undefined;
  do {
    const url = new URL(getAttendanceTableUrl());
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    
    // If employeeId is provided, filter by it using Airtable's filterByFormula
    if (params.employeeId) {
      const filter = `{EmployeeId}='${params.employeeId}'`;
      url.searchParams.set('filterByFormula', filter);
    }
    
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    console.log('[Attendance API] getAll response:', { params, recordCount: data.records?.length, data });
    if (data.records) records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  const mapped = records.map(mapRecord).filter(r => r !== null);
  console.log('[Attendance API] Mapped records:', mapped);
  return mapped;
}

// Get attendance by record id

async function getById(id) {
  const res = await fetch(`${getAttendanceTableUrl()}/${id}`, { headers: headers() });
  const data = await res.json();
  return mapRecord(data);
}

// Get attendance by employeeId and date

async function getByEmployeeAndDate(employeeId, date) {
  // Normalize date to YYYY-MM-DD format for consistent comparison
  let normalizedDate = date;
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      normalizedDate = d.toISOString().slice(0, 10);
    }
  }
  // Use FIND for string comparison (works for both string and number fields)
  // Compare date using DATETIME_FORMAT to normalize both sides
  const filter = `AND({EmployeeId}='${employeeId}', DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${normalizedDate}')`;
  const url = `${getAttendanceTableUrl()}?filterByFormula=${encodeURIComponent(filter)}`;
  console.log('[Attendance API] Checking for existing record:', { employeeId, date: normalizedDate, filter });
  const res = await fetch(url, { headers: headers() });
  const data = await res.json();
  console.log('[Attendance API] Result:', data.records?.length ? 'Found existing' : 'Not found', data);
  return data.records?.length ? mapRecord(data.records[0]) : null;
}

// Add new attendance record

async function add(attendance) {
  const body = {
    fields: mapToAirtableFields(attendance)
  };
  console.log('[Attendance API] Adding record with body:', JSON.stringify(body, null, 2));
  const res = await fetch(getAttendanceTableUrl(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log('[Attendance API] Add response:', { status: res.status, ok: res.ok, data });
  if (!res.ok) {
    throw new Error(`Airtable error: ${res.status} - ${JSON.stringify(data)}`);
  }
  
  const newRecord = mapRecord(data);
  
  // Log to Audit Log (CREATE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logCreate === 'function') {
      await window.AuditLog.logCreate('Human Resources', 'Attendance', newRecord, newRecord.id);
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return newRecord;
}

// Update attendance record

async function update(id, attendance) {
  // Fetch old record for audit logging
  let oldRecord = null;
  try {
    oldRecord = await getById(id);
  } catch (err) {
    console.warn('Could not fetch old attendance record:', err);
  }
  
  const body = {
    fields: mapToAirtableFields(attendance)
  };
  const res = await fetch(`${getAttendanceTableUrl()}/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const updatedRecord = mapRecord(data);
  
  // Log to Audit Log (UPDATE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logUpdate === 'function') {
      await window.AuditLog.logUpdate('Human Resources', 'Attendance', oldRecord, updatedRecord, id);
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return updatedRecord;
}

// Delete attendance record

async function remove(id) {
  // Fetch record for audit logging before delete
  let deletedRecord = null;
  try {
    deletedRecord = await getById(id);
  } catch (err) {
    console.warn('Could not fetch attendance record before delete:', err);
  }
  
  const res = await fetch(`${getAttendanceTableUrl()}/${id}`, {
    method: 'DELETE',
    headers: headers()
  });
  
  if (res.ok) {
    // Log to Audit Log (DELETE)
    try {
      if (window.AuditLog && typeof window.AuditLog.logDelete === 'function' && deletedRecord) {
        await window.AuditLog.logDelete('Human Resources', 'Attendance', deletedRecord, id);
      }
    } catch (auditErr) {
      console.warn('Audit log failed (non-blocking):', auditErr);
    }
  }
  
  return res.ok;
}

// Utility: map Airtable record to JS object
function mapRecord(record) {
  if (!record || !record.fields) return null;
  
  return {
    id: record.id,
    employeeId: record.fields.EmployeeId,
    date: record.fields.Date,
    timeInAM: record.fields.TimeInAM,
    timeOutAM: record.fields.TimeOutAM,
    timeInPM: record.fields.TimeInPM,
    timeOutPM: record.fields.TimeOutPM,
    totalHoursWorked: record.fields.TotalHoursWorked,
    overtimeHours: record.fields.OvertimeHours,
    overTimePay: record.fields.OverTimePay,
    isDoublePay: record.fields.IsDoublePay,
    leaveType: record.fields.LeaveType || '',
    remarks: record.fields.Remarks || '',
    createdAt: record.fields.CreatedAt,
    updatedAt: record.fields.UpdatedAt
  };
}

// Utility: map JS object to Airtable fields
function mapToAirtableFields(obj) {
  // Only save actual leave types, not 'None'
  const leaveType = (obj.leaveType && obj.leaveType !== 'None') ? obj.leaveType : '';
  
  const fields = {
    EmployeeId: obj.employeeId,
    Date: obj.date,
    TimeInAM: obj.timeInAM,
    TimeOutAM: obj.timeOutAM,
    TimeInPM: obj.timeInPM,
    TimeOutPM: obj.timeOutPM,
    TotalHoursWorked: obj.totalHoursWorked,
    OvertimeHours: obj.overtimeHours,
    OverTimePay: obj.overTimePay,
    IsDoublePay: obj.isDoublePay,
    LeaveType: leaveType,
    Remarks: obj.remarks || ''
  };
  return fields;
}

// Check if attendance exists for employee/date
async function exists(employeeId, date) {
  const record = await getByEmployeeAndDate(employeeId, date);
  return !!record;
}

// ============================================
// WINDOW EXPORTS (for non-module script loading)
// ============================================
window.attendanceApiGetAll = getAll;
window.attendanceApiGetById = getById;
window.attendanceApiAdd = add;
window.attendanceApiUpdate = update;
window.attendanceApiDelete = remove;
window.attendanceApiExists = exists;

})(); // End IIFE
