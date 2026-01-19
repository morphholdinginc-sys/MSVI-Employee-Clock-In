/*
 * compensation-api.js
 *
 * Airtable API layer for Compensation & Benefits Table
 * Mirrors the patterns used in `sss-api.js` and `employees-api.js`.
 */

// Wrap in IIFE to prevent variable conflicts
(function() {
'use strict';

// Use centralized config from airtable-config.js (must be loaded before this script)
const AIRTABLE_API_KEY = AIRTABLE_CONFIG.API_KEY;
const BASE_ID = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;

// Table names from centralized config
const COMPENSATION_TABLE = AIRTABLE_CONFIG.TABLES.PAYROLLS;
const PAYROLL_ITEMS_TABLE = AIRTABLE_CONFIG.TABLES.PAYROLL_ITEMS;

// Cache configuration
const CACHE_PREFIX = 'compApi_';
const CACHE_TS_PREFIX = 'compApiTs_';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCompensationTableUrl() {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(COMPENSATION_TABLE)}`;
}

function getPayrollItemsTableUrl() {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PAYROLL_ITEMS_TABLE)}`;
}

// Generic fetch-all with pagination
async function fetchAllFromAirtable(url) {
  let out = [];
  let fetchUrl = url;
  while (fetchUrl) {
    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Airtable fetch error', res.status, errorText);
      throw new Error(`Airtable error: ${res.status} - ${errorText}`);
    }
    const json = await res.json();
    out = out.concat(json.records);
    if (json.offset) {
      const sep = url.includes('?') ? '&' : '?';
      fetchUrl = `${url}${sep}offset=${json.offset}`;
    } else {
      fetchUrl = null;
    }
  }
  return out;
}

// Fields we care about (Airtable field names)
const COMP_FIELDS = [
  'EmployeeId',
  'Department',
  'BaseSalary',
  'Allowances',
  'Overtime',
  'GrossPay',
  'Deductions',
  'NetPay',
  'Remarks',
  'CreatedAt',
  'UpdatedAt',
];

// Fetch all payroll records
async function fetchAllCompensations() {
  const url = getCompensationTableUrl() + '?view=Grid%20view';
  const records = await fetchAllFromAirtable(url);
  return records.map(r => {
    const f = r.fields;
    return {
      id: r.id,
      employeeId: f.EmployeeId || '',
      department: f.Department || '',
      baseSalary: f.BaseSalary || '',
      allowances: f.Allowances || '',
      overtime: f.Overtime || '',
      grossPay: f.GrossPay || '',
      deductions: f.Deductions || '',
      netPay: f.NetPay || '',
      remarks: f.Remarks || '',
      createdAt: f.CreatedAt || '',
      updatedAt: f.UpdatedAt || '',
    };
  });
}

// Fetch a single payroll item by ID (for audit logging)
async function fetchPayrollItemById(id) {
  const url = `${getPayrollItemsTableUrl()}/${id}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.fields || null;
  } catch (e) {
    console.warn('Could not fetch payroll item for audit:', e);
    return null;
  }
}

// Fetch a single payroll (compensation) record by ID (for audit logging)
async function fetchPayrollById(id) {
  const url = `${getCompensationTableUrl()}/${id}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.fields || null;
  } catch (e) {
    console.warn('Could not fetch payroll for audit:', e);
    return null;
  }
}

// Delete a PayrollItem (breakdown) record by ID
async function deletePayrollItemRecord(id) {
  // Fetch record data before deleting (for audit log)
  let recordData = null;
  try {
    recordData = await fetchPayrollItemById(id);
  } catch (err) {
    console.warn('Could not fetch record before delete:', err);
  }
  
  const url = `${getPayrollItemsTableUrl()}/${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable delete PayrollItem error', res.status, errorText);
    throw new Error(`Airtable error: ${res.status} - ${errorText}`);
  }
  
  // Log to Audit Log (DELETE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logDelete === 'function') {
      const auditData = recordData ? {
        employeeId: recordData.EmployeeId,
        startDate: recordData.StartDate,
        endDate: recordData.EndDate,
        grossPay: recordData.GrossPay,
        netPay: recordData.NetPay,
        basicSalary: recordData.BasicSalary
      } : { recordId: id };
      await window.AuditLog.logDelete('Human Resources', 'PayrollItems', auditData, id);
      console.log('Audit log created for PayrollItems DELETE');
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return true;
}

// Delete a Payroll (compensation) record by ID
async function deleteCompensationRecord(id) {
  // Fetch record data before deleting (for audit log)
  let recordData = null;
  try {
    recordData = await fetchPayrollById(id);
  } catch (err) {
    console.warn('Could not fetch record before delete:', err);
  }
  
  const url = `${getCompensationTableUrl()}/${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable delete Payroll error', res.status, errorText);
    throw new Error(`Airtable error: ${res.status} - ${errorText}`);
  }
  
  // Log to Audit Log (DELETE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logDelete === 'function') {
      const auditData = recordData ? {
        employeeId: recordData.EmployeeId,
        department: recordData.Department,
        grossPay: recordData.GrossPay,
        netPay: recordData.NetPay,
        baseSalary: recordData.BaseSalary
      } : { recordId: id };
      await window.AuditLog.logDelete('Human Resources', 'Payrolls', auditData, id);
      console.log('Audit log created for Payrolls DELETE');
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return true;
}

// Create a new payroll record
async function createCompensationRecord(data) {
  const url = getCompensationTableUrl();
  const payload = {
    fields: {
      EmployeeId: data.employeeId || '',
      Department: data.department || '',
      BaseSalary: parseFloat(data.baseSalary) || 0,
      Allowances: parseFloat(data.allowances) || 0,
      Overtime: parseFloat(data.overtime) || 0,
      GrossPay: parseFloat(data.grossPay) || 0,
      Deductions: parseFloat(data.deductions) || 0,
      NetPay: parseFloat(data.netPay) || 0,
      Remarks: data.remarks || ''
      // Note: Individual contribution fields (SSS, PhilHealth, etc.) are stored in PayrollItems table, not Payrolls
    }
  };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable create error', res.status, errorText);
    throw new Error(`Airtable error: ${res.status} - ${errorText}`);
  }
  
  const result = await res.json();
  
  // Log to Audit Log (CREATE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logCreate === 'function') {
      const auditData = {
        employeeId: data.employeeId,
        department: data.department,
        baseSalary: data.baseSalary,
        grossPay: data.grossPay,
        netPay: data.netPay
      };
      await window.AuditLog.logCreate('Human Resources', 'Payrolls', auditData, result.id);
      console.log('Audit log created for Payrolls CREATE');
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return result;
}

// Create a new payroll item record (for daily breakdowns)
// Field names match the PayrollItems Airtable table schema
// Note: Only sending essential fields - additional data stored in DailyBreakdownJSON
async function createPayrollItemRecord(data) {
  const url = getPayrollItemsTableUrl();
  
  // Build extended data object to store in JSON
  const extendedData = {
    // Government Contribution Fields - Employee Share
    sssContribution: parseFloat(data.sssContribution) || 0,
    philHealthContribution: parseFloat(data.philHealthContribution) || 0,
    pagIbigContribution: parseFloat(data.pagIbigContribution) || 0,
    withholdingTax: parseFloat(data.withholdingTax) || 0,
    
    // Government Contribution Fields - Employer Share (for accounting)
    sssEmployer: parseFloat(data.sssEmployer) || 0,
    philHealthEmployer: parseFloat(data.philHealthEmployer) || 0,
    pagIbigEmployer: parseFloat(data.pagIbigEmployer) || 0,
    
    // Other Deduction Fields
    salaryAdvanceDeduction: parseFloat(data.salaryAdvanceDeduction) || 0,
    lateDeductions: parseFloat(data.lateDeductions) || 0,
    absenceDeductions: parseFloat(data.absentDeductions) || 0,
    otherDeductions: parseFloat(data.otherDeductions) || 0,
    
    // Analysis Fields
    totalRegularHours: parseFloat(data.totalRegularHours) || 0,
    totalOvertimeHours: parseFloat(data.totalOvertimeHours) || 0,
    breakdownPeriod: data.breakdownPeriod || ''
  };
  
  // Merge extended data into dailyBreakdownJSON if it exists
  let dailyBreakdownJSON = data.dailyBreakdownJSON || '';
  try {
    if (dailyBreakdownJSON) {
      const parsed = JSON.parse(dailyBreakdownJSON);
      parsed.contributions = extendedData;
      dailyBreakdownJSON = JSON.stringify(parsed);
    } else {
      dailyBreakdownJSON = JSON.stringify({ contributions: extendedData });
    }
  } catch (e) {
    dailyBreakdownJSON = JSON.stringify({ contributions: extendedData, rawData: dailyBreakdownJSON });
  }
  
  // Only send fields that exist in the Airtable PayrollItems table
  const fields = {
    // Core identifiers
    EmployeeId: data.employeeId || '',
    
    // Salary & Hours Fields
    BasicSalary: parseFloat(data.basicSalary) || 0,
    RegularHours: parseFloat(data.regularHours) || 0,
    OvertimeHours: parseFloat(data.overtimeHours) || 0,
    OvertimePay: parseFloat(data.overtimePay) || 0,
    Allowances: parseFloat(data.allowances) || 0,
    Bonuses: parseFloat(data.bonuses) || 0,
    
    // Pay Calculation Fields
    GrossPay: parseFloat(data.grossPay) || 0,
    NetPay: parseFloat(data.netPay) || 0,
    TotalDeductions: parseFloat(data.totalDeductions) || 0,
    
    // Status & Documentation
    Status: data.status || 'Pending',
    Remarks: data.remarks || '',
    
    // Date Fields
    StartDate: data.startDate || null,
    EndDate: data.endDate || null,
    
    // Breakdown & Analysis Fields - Store all contribution data in JSON
    DailyBreakdownJSON: dailyBreakdownJSON,
    IsDailyBreakdown: data.isDailyBreakdown || false
  };
  
  // Add PayrollId only if provided (it's optional)
  if (data.payrollId) {
    fields.PayrollId = data.payrollId;
  }
  
  const payload = { fields };
  
  console.log('Sending to Airtable PayrollItems:', JSON.stringify(payload, null, 2));
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable create payroll item error', res.status, errorText);
    throw new Error(`Airtable error: ${res.status} - ${errorText}`);
  }
  
  const result = await res.json();
  
  // Log to Audit Log (CREATE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logCreate === 'function') {
      const auditData = {
        employeeId: data.employeeId,
        employeeName: data.employeeName || '',
        startDate: data.startDate,
        endDate: data.endDate,
        grossPay: data.grossPay,
        netPay: data.netPay,
        basicSalary: data.basicSalary
      };
      await window.AuditLog.logCreate('Human Resources', 'PayrollItems', auditData, result.id);
      console.log('Audit log created for PayrollItems CREATE');
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return result;
}

// Fetch payroll items for an employee
async function fetchPayrollItemsForEmployee(employeeId) {
  console.log('Fetching payroll items for employee:', employeeId);
  
  // Try with exact match filter
  const filterFormula = encodeURIComponent(`{EmployeeId}='${employeeId}'`);
  const url = `${getPayrollItemsTableUrl()}?filterByFormula=${filterFormula}&sort[0][field]=CreatedAt&sort[0][direction]=desc`;
  
  console.log('Fetching from URL:', url);
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable fetch payroll items error', res.status, errorText);
    // If filter fails, try fetching all and filtering client-side
    console.log('Trying to fetch all records instead...');
    return await fetchAllPayrollItemsForEmployee(employeeId);
  }
  
  const json = await res.json();
  console.log('Fetched payroll items:', json.records?.length || 0, 'records');
  return json.records || [];
}

// Fallback: Fetch all payroll items and filter client-side
async function fetchAllPayrollItemsForEmployee(employeeId) {
  const url = getPayrollItemsTableUrl();
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  if (!res.ok) {
    console.error('Failed to fetch all payroll items');
    return [];
  }
  
  const json = await res.json();
  const allRecords = json.records || [];
  
  console.log('Total payroll items in table:', allRecords.length);
  
  // Filter client-side
  const filtered = allRecords.filter(record => {
    const recordEmployeeId = record.fields.EmployeeId;
    console.log('Comparing:', recordEmployeeId, 'with', employeeId);
    return recordEmployeeId === employeeId || recordEmployeeId === String(employeeId);
  });
  
  console.log('Filtered to', filtered.length, 'records for employee', employeeId);
  return filtered;
}

// Update a payroll item record
async function updatePayrollItemRecord(recordId, data) {
  // Fetch old record for audit logging
  let oldRecord = null;
  try {
    oldRecord = await fetchPayrollItemById(recordId);
  } catch (err) {
    console.warn('Could not fetch old payroll item record:', err);
  }
  
  const url = `${getPayrollItemsTableUrl()}/${recordId}`;
  const payload = {
    fields: {}
  };
  
  // Only include fields that are provided and exist in Airtable
  if (data.status !== undefined) payload.fields.Status = data.status;
  if (data.remarks !== undefined) payload.fields.Remarks = data.remarks;
  if (data.netPay !== undefined) payload.fields.NetPay = parseFloat(data.netPay);
  if (data.totalDeductions !== undefined) payload.fields.TotalDeductions = parseFloat(data.totalDeductions);
  if (data.dailyBreakdownJSON !== undefined) payload.fields.DailyBreakdownJSON = data.dailyBreakdownJSON;
  
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable update payroll item error', res.status, errorText);
    throw new Error(`Airtable error: ${res.status} - ${errorText}`);
  }
  
  const result = await res.json();
  
  // Log to Audit Log (UPDATE)
  try {
    if (window.AuditLog && typeof window.AuditLog.logUpdate === 'function') {
      const oldData = oldRecord ? {
        employeeId: oldRecord.EmployeeId,
        status: oldRecord.Status,
        netPay: oldRecord.NetPay
      } : {};
      const newData = {
        employeeId: result.fields?.EmployeeId,
        status: result.fields?.Status,
        netPay: result.fields?.NetPay,
        ...data
      };
      await window.AuditLog.logUpdate('Human Resources', 'PayrollItems', oldData, newData, recordId);
      console.log('Audit log created for PayrollItems UPDATE');
    }
  } catch (auditErr) {
    console.warn('Audit log failed (non-blocking):', auditErr);
  }
  
  return result;
}

// Fetch payroll items by date period (for payroll summary dashboard)
async function fetchPayrollItemsByPeriod(startDate, endDate) {
  // Build filter: records where StartDate >= startDate AND EndDate <= endDate
  // Or where BreakdownPeriod overlaps with the requested period
  const filterFormula = encodeURIComponent(
    `AND(
      {StartDate}>='${startDate}',
      {EndDate}<='${endDate}',
      {IsDailyBreakdown}=TRUE()
    )`
  );
  
  const url = `${getPayrollItemsTableUrl()}?filterByFormula=${filterFormula}&sort[0][field]=StartDate&sort[0][direction]=desc`;
  
  console.log('[fetchPayrollItemsByPeriod] Fetching:', { startDate, endDate, url });
  
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('Airtable fetch payroll items by period error:', res.status, errorText);
    throw new Error(`Failed to fetch payroll items: ${res.status}`);
  }
  
  const data = await res.json();
  console.log('[fetchPayrollItemsByPeriod] Found records:', data.records?.length || 0);
  return data.records || [];
}

// Export functions to window for use in other scripts
window.fetchAllCompensations = fetchAllCompensations;
window.deleteCompensationRecord = deleteCompensationRecord;
window.deletePayrollItemRecord = deletePayrollItemRecord;
window.createCompensationRecord = createCompensationRecord;
window.createPayrollItemRecord = createPayrollItemRecord;
window.fetchPayrollItemsForEmployee = fetchPayrollItemsForEmployee;
window.updatePayrollItemRecord = updatePayrollItemRecord;
window.fetchPayrollItemsByPeriod = fetchPayrollItemsByPeriod;

})(); // End IIFE
