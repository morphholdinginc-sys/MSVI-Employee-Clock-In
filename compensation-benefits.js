/*
 * compensation-benefits.js
 *
 * JavaScript for Compensation & Benefits Dashboard
 * Handles loading, rendering, viewing, and deleting payroll records.
 */

// Use window-level storage to persist data across tab switches
// This prevents data loss when the script is reloaded
if (!window._compBenefitsData) {
  window._compBenefitsData = {
    allCompensations: [],
    allEmployeesForComp: [],
    compCurrentPage: 1,
    compPageSize: 10,
    filteredCompensations: [],
    eventListenersAttached: false
  };
}

// Local references for convenience
let allCompensations = window._compBenefitsData.allCompensations;
let allEmployeesForComp = window._compBenefitsData.allEmployeesForComp;
let compCurrentPage = window._compBenefitsData.compCurrentPage;
let compPageSize = window._compBenefitsData.compPageSize;
let filteredCompensations = window._compBenefitsData.filteredCompensations;

// Selected compensation IDs for bulk delete
let selectedCompensationIds = new Set();

// Helper function to parse coreWorkingHours and get schedule span in hours
// Format: "8:00 AM - 6:00 PM" returns 10 (hours span)
function getScheduleSpanHours(coreWorkingHours) {
  if (!coreWorkingHours || coreWorkingHours === 'N/A') return null;
  
  const parseTo24hr = (timeStr) => {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;
    let [, hours, minutes, period] = match;
    let h = parseInt(hours, 10);
    if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + parseInt(minutes, 10); // Return total minutes
  };
  
  const parts = coreWorkingHours.split('-').map(s => s.trim());
  if (parts.length !== 2) return null;
  
  const startMinutes = parseTo24hr(parts[0]);
  const endMinutes = parseTo24hr(parts[1]);
  
  if (startMinutes === null || endMinutes === null) return null;
  
  return (endMinutes - startMinutes) / 60; // Return hours
}

// Initialize - check if DOM is ready or if we're dynamically loaded
function initCompensationBenefits() {
  // Setup event listeners immediately since content is already in DOM
  setupCompensationEventListeners();
  // Load data
  loadCompensations();
  // Initialize department filter
  initializeCompDepartmentFilter();
}

// Initialize department filter dropdown
async function initializeCompDepartmentFilter() {
  const departmentFilter = document.getElementById('compDepartmentFilter');
  if (!departmentFilter) return;
  
  // Style the select and existing options for dark theme
  departmentFilter.style.backgroundColor = '#0d1b0e';
  departmentFilter.style.color = '#fff';
  Array.from(departmentFilter.options).forEach(opt => {
    opt.style.backgroundColor = '#0d1b0e';
    opt.style.color = '#fff';
  });
  
  try {
    // Check if DepartmentsAPI is available
    if (window.DepartmentsAPI && typeof window.DepartmentsAPI.fetchAllDepartments === 'function') {
      const departments = await window.DepartmentsAPI.fetchAllDepartments();
      
      // Clear existing options except the first one (All Departments)
      while (departmentFilter.options.length > 1) {
        departmentFilter.remove(1);
      }
      
      // Add department options with inline styles for dark theme
      departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept.name;
        option.textContent = dept.name;
        option.style.backgroundColor = '#0d1b0e';
        option.style.color = '#fff';
        departmentFilter.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Error loading departments:', error);
  }
}

// Check if document is already loaded (for dynamic tab loading) or wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCompensationBenefits);
} else {
  // DOM already loaded, call init immediately (for dynamically loaded tabs)
  initCompensationBenefits();
}

// Setup event listeners
function setupCompensationEventListeners() {
  // Prevent duplicate event listener attachment on tab reloads
  if (window._compBenefitsData.eventListenersAttached) {
    console.log('[CompBenefits] Event listeners already attached, skipping');
    return;
  }
  
  // Add Compensation button - using onclick in HTML instead of addEventListener
  // to prevent multiple event bindings on dynamic tab reloads
  
  // Employee select change - using onchange to prevent duplicate listeners
  const empSelect = document.getElementById('compEmployeeSelect');
  if (empSelect) {
    empSelect.onchange = updateCompEmployeeInfo;
  }
  
  // Form input changes for real-time calculation
  const baseSalary = document.getElementById('addCompBaseSalary');
  const allowances = document.getElementById('addCompAllowances');
  const overtime = document.getElementById('addCompOvertime');
  const sss = document.getElementById('addCompSSS');
  
  [baseSalary, allowances, overtime, sss].forEach(input => {
    if (input) {
      input.oninput = calculateCompTotals;
    }
  });
  
  // Form submission
  const form = document.getElementById('addCompensationForm');
  if (form) {
    form.onsubmit = saveCompensationRecord;
  }
  
  // Close modal on outside click
  const modal = document.getElementById('addCompensationModal');
  if (modal) {
    modal.onclick = function(e) {
      if (e.target === modal) {
        closeAddCompensationModal();
      }
    };
  }
  
  window._compBenefitsData.eventListenersAttached = true;
  console.log('[CompBenefits] Event listeners attached successfully');
}

// Load all employees for Compensation & Benefits (like Attendance Management)
// Employees table is the source of truth for salary data
async function loadCompensations() {
  // Initialize department filter every time tab is loaded
  await initializeCompDepartmentFilter();
  
  const tbody = document.getElementById('compTableBody');
  const indicator = document.getElementById('compLoadingIndicator');
  
  if (indicator) { indicator.style.display = 'flex'; }
  if (tbody) tbody.innerHTML = '';
  
  try {
    // Load employees directly from the Employees table (source of truth)
    await loadEmployeesForComp();
    console.log('[CompBenefits] Loaded employees:', allEmployeesForComp.length);
    
    // Sort employees alphabetically by last name, then first name
    allEmployeesForComp.sort((a, b) => {
      const lastNameA = (a.lastName || '').toLowerCase();
      const lastNameB = (b.lastName || '').toLowerCase();
      if (lastNameA !== lastNameB) {
        return lastNameA.localeCompare(lastNameB);
      }
      const firstNameA = (a.firstName || '').toLowerCase();
      const firstNameB = (b.firstName || '').toLowerCase();
      return firstNameA.localeCompare(firstNameB);
    });
    
    // Use employees as the data source (not compensations)
    filteredCompensations = [...allEmployeesForComp];
    compCurrentPage = 1;
    
    // Sync to window storage
    window._compBenefitsData.allEmployeesForComp = allEmployeesForComp;
    window._compBenefitsData.filteredCompensations = filteredCompensations;
    window._compBenefitsData.compCurrentPage = compCurrentPage;
    
    if (indicator) { indicator.style.display = 'none'; }
    renderCompensationsPage(); // Use pagination
    updateCompensationSummary(allEmployeesForComp);
  } catch (e) {
    if (indicator) { indicator.style.display = 'none'; }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:#dc3545; text-align:center;">Error loading data: ${e.message}</td></tr>`;
    }
    console.error('Error loading employees for compensation:', e);
  }
}

// Pagination functions for compensation
function renderCompensationsPage() {
  const totalItems = filteredCompensations.length;
  const totalPages = Math.ceil(totalItems / compPageSize) || 1;
  
  if (compCurrentPage > totalPages) compCurrentPage = totalPages;
  if (compCurrentPage < 1) compCurrentPage = 1;
  
  const startIndex = (compCurrentPage - 1) * compPageSize;
  const endIndex = startIndex + compPageSize;
  const pageItems = filteredCompensations.slice(startIndex, endIndex);
  
  renderCompensations(pageItems);
  updateCompPaginationControls(totalItems, totalPages, startIndex, endIndex);
}

function updateCompPaginationControls(totalItems, totalPages, startIndex, endIndex) {
  const pageInfo = document.getElementById('compPageInfo');
  const showingInfo = document.getElementById('compShowingInfo');
  const prevBtn = document.getElementById('compPrevBtn');
  const nextBtn = document.getElementById('compNextBtn');
  
  if (pageInfo) pageInfo.textContent = `Page ${compCurrentPage} of ${totalPages}`;
  if (showingInfo) {
    const showEnd = Math.min(endIndex, totalItems);
    showingInfo.textContent = totalItems > 0 
      ? `Showing ${startIndex + 1}-${showEnd} of ${totalItems}` 
      : 'No records';
  }
  if (prevBtn) prevBtn.disabled = compCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = compCurrentPage >= totalPages;
}

window.changeCompPageSize = function() {
  const select = document.getElementById('compPageSize');
  if (select) {
    compPageSize = parseInt(select.value, 10) || 10;
    compCurrentPage = 1;
    renderCompensationsPage();
  }
};

window.prevCompPage = function() {
  if (compCurrentPage > 1) {
    compCurrentPage--;
    renderCompensationsPage();
  }
};

window.nextCompPage = function() {
  const totalPages = Math.ceil(filteredCompensations.length / compPageSize) || 1;
  if (compCurrentPage < totalPages) {
    compCurrentPage++;
    renderCompensationsPage();
  }
};

// Render employees to the compensation table (like Attendance Management)
function renderCompensations(data) {
  const tbody = document.getElementById('compTableBody');
  if (!tbody) return;
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#888;">No employees found</td></tr>`;
    return;
  }
  
  tbody.innerHTML = data.map(emp => {
    // Build full name: LastName, FirstName MiddleInitial Suffix
    const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
    const suffix = emp.suffix || '';
    const fullName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
    const nameStr = fullName.replace(/'/g, "\\'");
    const idStr = emp.employeeId ? `'${emp.employeeId}'` : "''";
    
    // Get salary info from employee record
    const baseSalary = parseFloat(emp.baseSalary) || parseFloat(emp.contractSalary) || 0;
    const allowance = parseFloat(emp.allowance) || parseFloat(emp.monthlyAllowance) || 0;
    const rateType = emp.rateType || 'N/A';
    const position = emp.positionTitle || emp.position || '';
    const jobLevel = emp.jobLevel || 'N/A';
    const contractStatus = emp.employmentType || '';
    
    return `
      <tr>
        <td>
          <div style="display:flex; gap:.5rem; align-items:center;">
            <div>
              <div class="employee-name">${fullName}</div>
              <div class="muted">${emp.employeeId || ''}</div>
            </div>
          </div>
        </td>
        <td class="employee-department">${emp.department || ''}</td>
        <td>${position}</td>
        <td class="employee-job-level">${jobLevel}</td>
        <td class="employee-contract">${contractStatus}</td>
        <td class="employee-rate-type">${rateType}</td>
        <td style="color:#28a745; font-weight:500;">${formatCurrency(baseSalary)}</td>
        <td style="color:#17a2b8; font-weight:500;">${formatCurrency(allowance)}</td>
        <td style="text-align:center;">
          <div class="actions-inline">
            <button class="actions-btn" onclick="window.viewEmployeePayroll(${idStr}, '${nameStr}')">View Payroll</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Format currency values
function formatCurrency(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Update summary metrics based on employee data
function updateCompensationSummary(data) {
  if (!data || data.length === 0) return;
  
  // Calculate total monthly salaries and allowances
  const totalSalary = data.reduce((sum, emp) => sum + (parseFloat(emp.baseSalary) || parseFloat(emp.contractSalary) || 0), 0);
  const totalAllowances = data.reduce((sum, emp) => sum + (parseFloat(emp.allowance) || parseFloat(emp.monthlyAllowance) || 0), 0);
  const avgSalary = data.length > 0 ? totalSalary / data.length : 0;
  
  const totalCompEl = document.getElementById('totalCompensation');
  const compEmployeesEl = document.getElementById('compEmployees');
  const avgBenefitsEl = document.getElementById('avgBenefits');
  const totalBonusesEl = document.getElementById('totalBonuses');
  
  if (totalCompEl) totalCompEl.textContent = formatCurrency(totalSalary);
  if (compEmployeesEl) compEmployeesEl.textContent = data.length;
  if (avgBenefitsEl) avgBenefitsEl.textContent = formatCurrency(avgSalary);
  if (totalBonusesEl) totalBonusesEl.textContent = formatCurrency(totalAllowances);
}

// Store current employee context for payroll view
let currentPayrollEmployeeId = null;
let currentPayrollEmployeeName = null;

// View employee payroll (new function - takes employeeId like attendance)
async function viewEmployeePayroll(employeeId, employeeName) {
  // Store current context
  currentPayrollEmployeeId = employeeId;
  currentPayrollEmployeeName = employeeName;
  window._currentBreakdownRecordId = employeeId;
  
  // Find employee data from loaded employees
  const employees = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
  const emp = employees.find(e => e.employeeId === employeeId);
  
  if (!emp) {
    showNotification('Employee not found', 'error');
    return;
  }
  
  // Show modal with employee data
  await showViewModal(emp);
}

// Expose viewEmployeePayroll globally
window.viewEmployeePayroll = viewEmployeePayroll;

// Legacy viewCompensation for backward compatibility (redirects to viewEmployeePayroll)
async function viewCompensation(id) {
  // This is now for backward compatibility - find employee by compensation id
  const record = allCompensations.find(r => r.id === id);
  if (record) {
    const emp = allEmployeesForComp.find(e => e.employeeId === record.employeeId);
    if (emp) {
      const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
      const suffix = emp.suffix || '';
      const fullName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
      await viewEmployeePayroll(record.employeeId, fullName);
      return;
    }
  }
  showNotification('Record not found', 'error');
}

// Show view modal - Updated to work with employee data directly
async function showViewModal(emp) {
  const modal = document.getElementById('viewCompensationModal');
  if (!modal) {
    console.error('View Compensation Modal not found');
    return;
  }
  
  // Build full name: LastName, FirstName MiddleInitial Suffix
  const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
  const suffix = emp.suffix || '';
  const employeeName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ') || emp.employeeId;
  const department = emp.department || 'N/A';
  
  // Set employee info header
  const employeeInfo = document.getElementById('viewPayrollEmployeeInfo');
  if (employeeInfo) {
    employeeInfo.textContent = `${employeeName} (${emp.employeeId}) - ${department}`;
  }
  
  // Store employee data in hidden fields for breakdown modal
  const empIdField = document.getElementById('viewCompEmpId');
  const empNameField = document.getElementById('viewCompEmpName');
  const deptField = document.getElementById('viewCompDept');
  
  if (empIdField) empIdField.value = emp.employeeId;
  if (empNameField) empNameField.value = employeeName;
  if (deptField) deptField.value = department;
  
  // Check and show SSS age exemption banner for employees 60+
  const viewSssBanner = document.getElementById('viewSssAgeExemptionBanner');
  if (viewSssBanner) {
    const empAge = calculateAge(emp.dateOfBirth);
    if (empAge !== null && empAge >= 60) {
      viewSssBanner.style.display = 'block';
    } else {
      viewSssBanner.style.display = 'none';
    }
  }
  
  // Check and show Pag-IBIG age exemption banner for employees 60+
  const viewPagibigBanner = document.getElementById('viewPagibigAgeExemptionBanner');
  if (viewPagibigBanner) {
    const empAge = calculateAge(emp.dateOfBirth);
    if (empAge !== null && empAge >= 60) {
      viewPagibigBanner.style.display = 'block';
    } else {
      viewPagibigBanner.style.display = 'none';
    }
  }
  
  // Get salary info from employee record (source of truth)
  const baseSalary = parseFloat(emp.baseSalary) || parseFloat(emp.contractSalary) || 0;
  const allowances = parseFloat(emp.allowance) || parseFloat(emp.monthlyAllowance) || 0;
  const overtime = calculateOvertimeRate(emp.employeeId); // Calculate OT rate
  const grossPay = baseSalary + allowances;
  
  document.getElementById('viewBasicSalary').value = baseSalary.toFixed(2);
  document.getElementById('viewAllowances').value = allowances.toFixed(2);
  document.getElementById('viewOvertimePay').value = overtime.toFixed(2);
  document.getElementById('viewGrossPay').value = grossPay.toFixed(2);
  
  // Calculate government-mandated contributions using GovContributions module
  // For preview: use contract salary (baseSalary) as both contract and earned
  // Actual earned salary will be calculated in Daily Breakdown
  let sssContribution = 0;
  let philHealthContribution = 0;
  let pagIbigContribution = 0;
  let withholdingTax = 0;
  
  if (window.GovContributions) {
    // Calculate all contributions based on monthly contract salary
    // Pass dateOfBirth for SSS age exemption check (60+ years old are exempt)
    const contributions = window.GovContributions.calculateAllContributions({
      contractBasicSalary: baseSalary,
      earnedBasicSalary: baseSalary, // For preview, assume full salary earned
      overtimePay: overtime,
      otherEarnings: 0, // Allowance is de minimis, not taxable
      deMinimis: allowances,
      frequency: 'monthly',
      dateOfBirth: emp.dateOfBirth || null
    });
    
    sssContribution = contributions.sss.employee;
    philHealthContribution = contributions.philHealth.employee;
    pagIbigContribution = contributions.pagIbig.employee;
    withholdingTax = contributions.bir.tax;
    
    console.log('Calculated government contributions:', contributions);
  } else {
    // Fallback: Try to fetch SSS from Airtable if calculator not available
    sssContribution = await fetchSSSEmployeeContribution(emp.employeeId);
    console.warn('GovContributions module not loaded, using Airtable SSS only');
  }
  
  // Total government deductions only (no salary advance in preview)
  const totalDeductions = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
  
  // Set government deduction fields
  document.getElementById('viewSSS').value = sssContribution.toFixed(2);
  
  const viewPhilHealth = document.getElementById('viewPhilHealth');
  if (viewPhilHealth) viewPhilHealth.value = philHealthContribution.toFixed(2);
  
  const viewPagIbig = document.getElementById('viewPagIbig');
  if (viewPagIbig) viewPagIbig.value = pagIbigContribution.toFixed(2);
  
  const viewWithholdingTax = document.getElementById('viewWithholdingTax');
  if (viewWithholdingTax) viewWithholdingTax.value = withholdingTax.toFixed(2);
  
  document.getElementById('viewTotalDeductions').value = totalDeductions.toFixed(2);
  
  // Calculate net pay
  const netPay = grossPay - totalDeductions;
  document.getElementById('viewNetPay').value = netPay.toFixed(2);
  
  // Clear remarks (not applicable in employee-based view)
  const remarksField = document.getElementById('viewRemarks');
  if (remarksField) {
    remarksField.value = '';
  }
  
  // Load breakdown history for this employee
  await loadBreakdownHistory(emp.employeeId);
  
  // Show modal
  modal.style.display = 'block';
}

// Load breakdown history from PayrollItems table
async function loadBreakdownHistory(employeeId) {
  const tbody = document.getElementById('breakdownHistoryBody');
  if (!tbody) {
    console.error('breakdownHistoryBody element not found');
    return;
  }
  
  console.log('Loading breakdown history for employee:', employeeId);
  
  // Show loading
  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center; padding:1.5rem; color:#888;">
        <div style="display:inline-block; width:16px; height:16px; border:2px solid #0dcaf0; border-radius:50%; border-top-color:transparent; animation:spin 1s linear infinite;"></div>
        Loading...
      </td>
    </tr>
  `;
  
  try {
    // Check if fetchPayrollItemsForEmployee function exists
    if (!window.fetchPayrollItemsForEmployee) {
      console.error('fetchPayrollItemsForEmployee not available - check if compensation-api.js is loaded');
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:1.5rem; color:#888;">
            No breakdown records found
          </td>
        </tr>
      `;
      return;
    }
    
    // Fetch payroll items for this employee
    console.log('Calling fetchPayrollItemsForEmployee...');
    const records = await window.fetchPayrollItemsForEmployee(employeeId);
    
    console.log('Received records:', records);
    
    if (!records || records.length === 0) {
      console.log('No records found for employee:', employeeId);
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:1.5rem; color:#888;">
            No breakdown records found
          </td>
        </tr>
      `;
      return;
    }
    
    console.log('Rendering', records.length, 'breakdown records');
    
    // Sort records by start date descending (latest first)
    records.sort((a, b) => {
      const dateA = new Date(a.fields.StartDate || '1970-01-01');
      const dateB = new Date(b.fields.StartDate || '1970-01-01');
      return dateB - dateA; // Descending order
    });
    
    // Store records globally for filtering
    window.breakdownHistoryRecords = records;
    
    // Render breakdown history rows
    renderBreakdownHistoryRows(records);
    
  } catch (error) {
    console.error('Error loading breakdown history:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:1.5rem; color:#dc3545;">
          Error loading breakdown history
        </td>
      </tr>
    `;
  }
}

// Render breakdown history rows from records
function renderBreakdownHistoryRows(records) {
  const tbody = document.getElementById('breakdownHistoryBody');
  if (!tbody) return;
  
  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:1.5rem; color:#888;">
          No breakdown records found
        </td>
      </tr>
    `;
    return;
  }
  
  // Sort records by StartDate in descending order (latest first)
  const sortedRecords = [...records].sort((a, b) => {
    const dateA = new Date(a.fields.StartDate || 0);
    const dateB = new Date(b.fields.StartDate || 0);
    return dateB - dateA; // Descending order
  });
  
  const rows = sortedRecords.map(record => {
    const fields = record.fields;
    // Get breakdown period from JSON or fields
    let breakdownPeriod = '';
    try {
      const breakdown = JSON.parse(fields.DailyBreakdownJSON || '{}');
      breakdownPeriod = breakdown.contributions?.breakdownPeriod || '';
    } catch(e) {}
    const period = breakdownPeriod || `${fields.StartDate || ''} to ${fields.EndDate || ''}`;
    
    // Format start and end dates for display
    const startDateStr = fields.StartDate || '';
    const endDateStr = fields.EndDate || '';
    let formattedStartDate = startDateStr;
    let formattedEndDate = endDateStr;
    try {
      if (startDateStr) {
        const sd = new Date(startDateStr);
        formattedStartDate = sd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (endDateStr) {
        const ed = new Date(endDateStr);
        formattedEndDate = ed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch(e) {}
    
    // Calculate actual days in period (not based on hours)
    let totalDays = '-';
    if (fields.StartDate && fields.EndDate) {
      const startDate = new Date(fields.StartDate);
      const endDate = new Date(fields.EndDate);
      const diffTime = Math.abs(endDate - startDate);
      totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
    } else if (fields.WorkDays) {
      totalDays = fields.WorkDays;
    }
    
    // Parse DailyBreakdownJSON to get accurate values (prioritize JSON over fields)
    let breakdownData = null;
    let contributionsData = null;
    if (fields.DailyBreakdownJSON) {
      try {
        breakdownData = JSON.parse(fields.DailyBreakdownJSON);
        contributionsData = breakdownData?.contributions || null;
      } catch (e) {
        console.warn('Could not parse DailyBreakdownJSON:', e);
      }
    }
    
    // Use values from JSON contributions if available (more accurate), fallback to fields
    const earnings = contributionsData?.grossPay ?? parseFloat(fields.GrossPay) ?? 0;
    const deductions = contributionsData?.totalDeductions ?? parseFloat(fields.TotalDeductions) ?? 0;
    const netPay = contributionsData?.netPay ?? parseFloat(fields.NetPay) ?? 0;
    
    return `
      <tr style="border-bottom:1px solid #275b48;">
        <td style="padding:0.5rem; color:#fff; font-size:0.85rem; line-height:1.5;">
          <span style="color:#aaa;">Start Date</span> <span style="color:#fff;">${formattedStartDate}</span><br>
          <span style="color:#aaa;">End Date</span> <span style="color:#fff;">${formattedEndDate}</span>
        </td>
        <td style="padding:0.5rem; text-align:center; color:#fff;">${totalDays}</td>
        <td style="padding:0.5rem; text-align:right; color:#28a745;">₱${earnings.toFixed(2)}</td>
        <td style="padding:0.5rem; text-align:right; color:#dc3545;">₱${deductions.toFixed(2)}</td>
        <td style="padding:0.5rem; text-align:right; color:#0dcaf0; font-weight:600;">₱${netPay.toFixed(2)}</td>
        <td style="padding:0.5rem; text-align:center;">
          <button class="actions-btn" style="padding:0.25rem 0.5rem; font-size:0.75rem;" 
                  onclick="window.viewBreakdownDetails('${record.id}')">View</button>
          <button class="actions-btn delete-btn" style="padding:0.25rem 0.5rem; font-size:0.75rem; margin-left:0.25rem;" 
                  onclick="window.showDeleteBreakdownModal('${record.id}', '${period.replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
  
  tbody.innerHTML = rows;
}

// Filter breakdown history by cut type
function filterBreakdownHistory(filterType) {
  const records = window.breakdownHistoryRecords || [];
  
  // Update button styles
  document.querySelectorAll('.breakdown-filter-btn').forEach(btn => {
    if (btn.dataset.filter === filterType) {
      btn.style.background = '#198754';
      btn.classList.add('active');
    } else {
      btn.style.background = '#6c757d';
      btn.classList.remove('active');
    }
  });
  
  if (filterType === 'all') {
    renderBreakdownHistoryRows(records);
    return;
  }
  
  const filteredRecords = records.filter(record => {
    const fields = record.fields;
    const endDate = fields.EndDate || '';
    
    if (!endDate) return false;
    
    // Parse the end date to get the day
    const day = parseInt(endDate.split('-')[2], 10);
    
    if (filterType === '1st') {
      // 1st cut: ends on 15th
      return day === 15;
    } else if (filterType === '2nd') {
      // 2nd cut: ends on 30th or 31st (end of month)
      return day >= 28 && day <= 31;
    } else if (filterType === 'whole') {
      // Whole month: check if period spans from 1st to end of month
      const startDate = fields.StartDate || '';
      if (!startDate) return false;
      const startDay = parseInt(startDate.split('-')[2], 10);
      return startDay === 1 && day >= 28;
    }
    
    return true;
  });
  
  renderBreakdownHistoryRows(filteredRecords);
}

// Expose filter function globally
window.filterBreakdownHistory = filterBreakdownHistory;

// View breakdown details from history
async function viewBreakdownDetails(recordId) {
  try {
    // Fetch the specific payroll item using centralized config
    const baseId = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
    const apiKey = AIRTABLE_CONFIG.API_KEY;
    const table = AIRTABLE_CONFIG.TABLES.PAYROLL_ITEMS;
    
    const url = `https://api.airtable.com/v0/${baseId}/${table}/${recordId}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch breakdown details');
    }
    
    const record = await response.json();
    const fields = record.fields;
    
    console.log('Loaded PayrollItem fields:', fields);
    
    // Get employee data from cache - use window storage
    const employeeId = fields.EmployeeId;
    const employeesCache = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
    let employee = employeesCache.find(e => e.employeeId === employeeId);
    
    // If not found, load employees
    if (!employee && employeesCache.length === 0) {
      await loadEmployeesForComp();
      const refreshedCache = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
      employee = refreshedCache.find(e => e.employeeId === employeeId);
    }
    
    console.log('Found employee:', employee);
    
    // Calculate rates from employee data
    const baseSalary = employee?.baseSalary || fields.BasicSalary || 0;
    const standardWorkweekHours = employee?.standardWorkweekHours || 40;
    const rateType = employee?.rateType || 'Time-based';
    const isFixedRate = rateType === 'Fixed';
    const coreWorkingHours = employee?.coreWorkingHours || '';
    
    const dailyRate = baseSalary / 30;
    // Daily standard hours = Standard Workweek Hours / 7 days
    // If Core Working Hours span equals daily standard and > 8 hrs, lunch break wasn't accounted for
    const scheduleSpan = getScheduleSpanHours(coreWorkingHours);
    const dailyFromWeekly = standardWorkweekHours / 7;
    let dailyStandardHours = dailyFromWeekly;
    const hasLunchAdjustment = scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8;
    if (hasLunchAdjustment) {
      dailyStandardHours = dailyFromWeekly - 1; // Subtract 1 hour for lunch
    }
    const hourlyRate = dailyStandardHours > 0 ? dailyRate / dailyStandardHours : 0;
    const overtimeRate = isFixedRate ? 0 : hourlyRate * 1.25;
    
    // Calculate work days from period based on rate type
    // Fixed: ALL calendar days (including Sat/Sun)
    // Time-based: This will be overridden by totalDays from saved attendance data
    let workDays = 0;
    if (fields.StartDate && fields.EndDate) {
      if (isFixedRate) {
        workDays = calculateAllDaysInPeriod(fields.StartDate, fields.EndDate);
      } else {
        // For Time-based, use the stored totalDays from attendance, not period calculation
        workDays = 0; // Will be set from breakdownData.totals.totalDays below
      }
    }
    
    // Parse the daily breakdown JSON if available
    let breakdownData = null;
    let contributionsData = null;
    if (fields.DailyBreakdownJSON) {
      try {
        breakdownData = JSON.parse(fields.DailyBreakdownJSON);
        console.log('Parsed DailyBreakdownJSON:', breakdownData);
        // Extract contributions from the JSON (new format)
        contributionsData = breakdownData?.contributions || null;
      } catch (e) {
        console.warn('Could not parse DailyBreakdownJSON:', e);
      }
    }
    
    // Build complete breakdown data from fields and parsed JSON
    const employeeMiddleInitial = employee?.middleName ? `${employee.middleName.charAt(0)}.` : '';
    const employeeSuffix = employee?.suffix || '';
    const employeeFullName = employee ? (employee.lastName || '') + (employee.firstName || employeeMiddleInitial || employeeSuffix ? ', ' : '') + [employee.firstName || '', employeeMiddleInitial, employeeSuffix].filter(n => n).join(' ') : '';
    const completeBreakdownData = {
      // Employee info
      employeeId: employeeId,
      employeeName: employeeFullName || (breakdownData?.employeeName || employeeId),
      department: employee?.department || breakdownData?.department || '',
      
      // Period
      startDate: fields.StartDate || breakdownData?.startDate,
      endDate: fields.EndDate || breakdownData?.endDate,
      
      // Rates (from employee data)
      rates: {
        dailyRate: dailyRate,
        hourlyRate: hourlyRate,
        overtimeRate: overtimeRate,
        isFixedRate: isFixedRate,
        standardWorkweekHours: standardWorkweekHours,
        coreWorkingHours: employee?.coreWorkingHours || ''
      },
      rateType: rateType,
      // Work Days: For Fixed use calculated, for Time-based use saved attendance totalDays
      workDays: isFixedRate ? workDays : (breakdownData?.totals?.totalDays || workDays),
      
      // Daily records (from saved JSON)
      dailyRecords: breakdownData?.dailyRecords || [],
      
      // Totals from fields
      totals: {
        // For Time-based, use saved totalDays from attendance (present days only)
        totalDays: isFixedRate ? workDays : (breakdownData?.totals?.totalDays || workDays),
        totalRegularHours: contributionsData?.totalRegularHours || breakdownData?.totals?.totalRegularHours || 0,
        totalOvertimeHours: contributionsData?.totalOvertimeHours || breakdownData?.totals?.totalOvertimeHours || 0,
        totalRegularPay: breakdownData?.totals?.totalRegularPay || (fields.GrossPay - fields.OvertimePay) || 0,
        totalOvertimePay: fields.OvertimePay || breakdownData?.totals?.totalOvertimePay || 0,
        allowance: fields.Allowances || breakdownData?.totals?.allowance || 0,
        doublePay: fields.Bonuses || breakdownData?.totals?.doublePay || 0,
        perfectAttendanceBonus: breakdownData?.totals?.perfectAttendanceBonus || 0,
        hasPerfectAttendance: breakdownData?.totals?.hasPerfectAttendance || false,
        leaveConversionBonus: breakdownData?.totals?.leaveConversionBonus || 0,
        totalLateMinutes: breakdownData?.totals?.totalLateMinutes || 0,
        totalAbsentDays: breakdownData?.totals?.totalAbsentDays || 0,
        lateDeductions: contributionsData?.lateDeductions || breakdownData?.totals?.lateDeductions || 0,
        absentDeductions: contributionsData?.absenceDeductions || breakdownData?.totals?.absentDeductions || 0,
        // Government contributions - employee share (from JSON contributions object)
        sssContribution: contributionsData?.sssContribution || breakdownData?.totals?.sssContribution || 0,
        philHealthContribution: contributionsData?.philHealthContribution || breakdownData?.totals?.philHealthContribution || 0,
        pagIbigContribution: contributionsData?.pagIbigContribution || breakdownData?.totals?.pagIbigContribution || 0,
        withholdingTax: contributionsData?.withholdingTax || breakdownData?.totals?.withholdingTax || 0,
        // Government contributions - employer share (from JSON contributions object)
        sssEmployer: contributionsData?.sssEmployer || breakdownData?.totals?.sssEmployer || 0,
        philHealthEmployer: contributionsData?.philHealthEmployer || breakdownData?.totals?.philHealthEmployer || 0,
        pagIbigEmployer: contributionsData?.pagIbigEmployer || breakdownData?.totals?.pagIbigEmployer || 0,
        // Other deductions (from JSON contributions object)
        advanceDeduction: contributionsData?.salaryAdvanceDeduction || breakdownData?.totals?.advanceDeduction || 0,
        otherDeductions: contributionsData?.otherDeductions || breakdownData?.totals?.otherDeductions || 0,
        totalDeductions: fields.TotalDeductions || breakdownData?.totals?.totalDeductions || 0,
        grossPay: fields.GrossPay || breakdownData?.totals?.grossPay || 0,
        netPay: fields.NetPay || breakdownData?.totals?.netPay || 0
      }
    };
    
    console.log('Complete breakdown data:', completeBreakdownData);
    
    // Show in view breakdown modal
    showViewBreakdownModal(completeBreakdownData);
    
  } catch (error) {
    console.error('Error viewing breakdown details:', error);
    showNotification('Error loading breakdown details', 'error');
  }
}

// Close view modal
function closeViewCompensationModal() {
  const modal = document.getElementById('viewCompensationModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// ===== EDIT SALARY MODAL FUNCTIONS =====

// Show Edit Salary Modal
function showEditSalaryModal() {
  const modal = document.getElementById('editSalaryModal');
  if (!modal) return;
  
  // Get current employee from the view modal
  const employeeId = document.getElementById('viewCompEmpId')?.value;
  const employeeName = document.getElementById('viewCompEmpName')?.value;
  
  if (!employeeId) {
    showNotification('No employee selected', 'error');
    return;
  }
  
  // Find the employee data
  const employees = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
  const emp = employees.find(e => e.employeeId === employeeId);
  
  if (!emp) {
    showNotification('Employee data not found', 'error');
    return;
  }
  
  // Populate the modal
  document.getElementById('editSalaryEmployeeInfo').textContent = `${employeeName} (${employeeId})`;
  document.getElementById('editSalaryRecordId').value = emp.id; // Airtable record ID
  document.getElementById('editSalaryEmployeeId').value = employeeId;
  document.getElementById('editBaseSalary').value = (parseFloat(emp.baseSalary) || parseFloat(emp.contractSalary) || 0).toFixed(2);
  document.getElementById('editAllowance').value = (parseFloat(emp.allowance) || parseFloat(emp.monthlyAllowance) || 0).toFixed(2);
  
  // Setup form submit handler
  const form = document.getElementById('editSalaryForm');
  if (form) {
    form.onsubmit = saveEditSalary;
  }
  
  modal.style.display = 'block';
}

// Close Edit Salary Modal
function closeEditSalaryModal() {
  const modal = document.getElementById('editSalaryModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Save edited salary to Employees table in Airtable
async function saveEditSalary(e) {
  e.preventDefault();
  
  const recordId = document.getElementById('editSalaryRecordId')?.value;
  const employeeId = document.getElementById('editSalaryEmployeeId')?.value;
  const newBaseSalary = parseFloat(document.getElementById('editBaseSalary')?.value) || 0;
  const newAllowance = parseFloat(document.getElementById('editAllowance')?.value) || 0;
  
  if (!recordId) {
    showNotification('Record ID not found', 'error');
    return;
  }
  
  try {
    // Update the Employees table in Airtable
    const AIRTABLE_API_KEY = AIRTABLE_CONFIG.API_KEY;
    const BASE_ID = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
    const TABLE_NAME = AIRTABLE_CONFIG.TABLES.EMPLOYEE_DIRECTORY;
    
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${recordId}`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          BaseSalary: newBaseSalary,
          Allowance: newAllowance
        }
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update salary');
    }
    
    const updatedRecord = await response.json();
    console.log('[CompBenefits] Salary updated:', updatedRecord);
    
    // Update local cache
    const employees = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
    const empIndex = employees.findIndex(e => e.employeeId === employeeId);
    if (empIndex >= 0) {
      employees[empIndex].baseSalary = newBaseSalary;
      employees[empIndex].contractSalary = newBaseSalary;
      employees[empIndex].allowance = newAllowance;
      employees[empIndex].monthlyAllowance = newAllowance;
    }
    
    // Close modal and refresh
    closeEditSalaryModal();
    showNotification('Salary updated successfully!', 'success');
    
    // Refresh the view modal with updated data
    if (employeeId) {
      const emp = employees.find(e => e.employeeId === employeeId);
      if (emp) {
        await showViewModal(emp);
      }
    }
    
    // Refresh the main table
    renderCompensationsPage();
    
  } catch (error) {
    console.error('Error updating salary:', error);
    showNotification('Failed to update salary: ' + error.message, 'error');
  }
}

// Expose Edit Salary functions globally
window.showEditSalaryModal = showEditSalaryModal;
window.closeEditSalaryModal = closeEditSalaryModal;
window.saveEditSalary = saveEditSalary;

// Show delete confirmation modal
function deleteCompensation(id) {
  const modal = document.getElementById('deleteCompensationModal');
  const hiddenId = document.getElementById('deleteCompensationId');
  const hiddenEmpId = document.getElementById('deleteCompensationEmployeeId');
  const breakdownWarning = document.getElementById('deleteBreakdownWarning');
  
  // Find the compensation record to get the employee ID
  const record = allCompensations.find(r => r.id === id);
  const employeeId = record?.employeeId || '';
  
  if (modal && hiddenId) {
    hiddenId.value = id;
    if (hiddenEmpId) hiddenEmpId.value = employeeId;
    
    // Check if there are breakdown records for this employee
    if (employeeId && breakdownWarning) {
      // Show warning that breakdown records will also be deleted
      breakdownWarning.style.display = 'block';
    } else if (breakdownWarning) {
      breakdownWarning.style.display = 'none';
    }
    
    modal.style.display = 'flex';
  }
}

// Close delete confirmation modal
function closeDeleteCompensationModal() {
  const modal = document.getElementById('deleteCompensationModal');
  if (modal) {
    modal.style.display = 'none';
  }
  document.getElementById('deleteCompensationId').value = '';
  const empIdField = document.getElementById('deleteCompensationEmployeeId');
  if (empIdField) empIdField.value = '';
  const breakdownWarning = document.getElementById('deleteBreakdownWarning');
  if (breakdownWarning) breakdownWarning.style.display = 'none';
}

// Confirm and delete compensation record
async function confirmDeleteCompensation() {
  const id = document.getElementById('deleteCompensationId')?.value;
  const employeeId = document.getElementById('deleteCompensationEmployeeId')?.value;
  if (!id) return;
  
  try {
    // First, delete all related PayrollItems (breakdown records) for this employee
    let breakdownDeleteCount = 0;
    if (employeeId && window.fetchPayrollItemsForEmployee && window.deletePayrollItemRecord) {
      try {
        const breakdownRecords = await window.fetchPayrollItemsForEmployee(employeeId);
        console.log(`Found ${breakdownRecords.length} breakdown records for employee ${employeeId}`);
        
        // Delete each breakdown record
        for (const record of breakdownRecords) {
          try {
            await window.deletePayrollItemRecord(record.id);
            breakdownDeleteCount++;
          } catch (delErr) {
            console.warn(`Failed to delete breakdown record ${record.id}:`, delErr);
          }
        }
        console.log(`Deleted ${breakdownDeleteCount} breakdown records`);
      } catch (fetchErr) {
        console.warn('Error fetching breakdown records:', fetchErr);
      }
    }
    
    // Delete the main payroll record (audit logging is handled in compensation-api.js)
    const success = await window.deleteCompensationRecord(id);
    if (success) {
      closeDeleteCompensationModal();
      if (breakdownDeleteCount > 0) {
        showNotification(`Payroll record and ${breakdownDeleteCount} breakdown record(s) deleted successfully`, 'success');
      } else {
        showNotification('Payroll record deleted successfully', 'success');
      }
      await loadCompensations();
    } else {
      showNotification('Failed to delete payroll record', 'error');
    }
  } catch (e) {
    console.error('Error deleting compensation:', e);
    showNotification('Error deleting payroll record: ' + e.message, 'error');
  }
}

// Expose delete modal functions globally
window.deleteCompensation = deleteCompensation;
window.closeDeleteCompensationModal = closeDeleteCompensationModal;
window.confirmDeleteCompensation = confirmDeleteCompensation;

// =============================================
// Multi-Select Delete Functions
// =============================================

// Toggle selection of a single compensation record
function toggleCompSelection(id) {
  if (selectedCompensationIds.has(id)) {
    selectedCompensationIds.delete(id);
  } else {
    selectedCompensationIds.add(id);
  }
  updateDeleteSelectedCompBtn();
  updateSelectAllCompState();
}

// Toggle select all checkboxes
function toggleSelectAllComp() {
  const selectAllCheckbox = document.getElementById('selectAllComp');
  const checkboxes = document.querySelectorAll('.comp-select-checkbox');
  
  if (selectAllCheckbox.checked) {
    // Select all visible records
    checkboxes.forEach(cb => {
      const id = cb.getAttribute('data-id');
      if (id) {
        selectedCompensationIds.add(id);
        cb.checked = true;
      }
    });
  } else {
    // Deselect all visible records
    checkboxes.forEach(cb => {
      const id = cb.getAttribute('data-id');
      if (id) {
        selectedCompensationIds.delete(id);
        cb.checked = false;
      }
    });
  }
  updateDeleteSelectedCompBtn();
}

// Update the state of the "Select All" checkbox based on individual selections
function updateSelectAllCompState() {
  const selectAllCheckbox = document.getElementById('selectAllComp');
  const checkboxes = document.querySelectorAll('.comp-select-checkbox');
  
  if (!selectAllCheckbox || checkboxes.length === 0) return;
  
  const checkedCount = document.querySelectorAll('.comp-select-checkbox:checked').length;
  
  if (checkedCount === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (checkedCount === checkboxes.length) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

// Update the Delete Selected button visibility and count
function updateDeleteSelectedCompBtn() {
  const btn = document.getElementById('deleteSelectedCompBtn');
  const countSpan = document.getElementById('selectedCompCount');
  
  if (btn && countSpan) {
    const count = selectedCompensationIds.size;
    countSpan.textContent = count;
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// Show bulk delete confirmation modal
function showBulkDeleteCompModal() {
  if (selectedCompensationIds.size === 0) {
    showNotification('No records selected for deletion', 'error');
    return;
  }
  
  const modal = document.getElementById('bulkDeleteCompModal');
  const countEl = document.getElementById('bulkDeleteCompCount');
  
  if (modal && countEl) {
    countEl.textContent = selectedCompensationIds.size;
    modal.style.display = 'flex';
  }
}

// Close bulk delete modal
function closeBulkDeleteCompModal() {
  const modal = document.getElementById('bulkDeleteCompModal');
  if (modal) modal.style.display = 'none';
}

// Confirm and execute bulk delete
async function confirmBulkDeleteComp() {
  if (selectedCompensationIds.size === 0) return;
  
  const idsToDelete = Array.from(selectedCompensationIds);
  let successCount = 0;
  let failCount = 0;
  
  // Close modal and show progress
  closeBulkDeleteCompModal();
  showNotification(`Deleting ${idsToDelete.length} records...`, 'info');
  
  for (const id of idsToDelete) {
    try {
      // Delete record (audit logging is handled in compensation-api.js)
      const success = await window.deleteCompensationRecord(id);
      if (success) {
        successCount++;
        selectedCompensationIds.delete(id);
      } else {
        failCount++;
      }
    } catch (e) {
      console.error('Error deleting compensation record:', id, e);
      failCount++;
    }
  }
  
  // Clear selection and refresh
  selectedCompensationIds.clear();
  updateDeleteSelectedCompBtn();
  
  if (failCount === 0) {
    showNotification(`Successfully deleted ${successCount} records`, 'success');
  } else {
    showNotification(`Deleted ${successCount} records, ${failCount} failed`, 'error');
  }
  
  await loadCompensations();
}

// Expose multi-select functions globally
window.toggleCompSelection = toggleCompSelection;
window.toggleSelectAllComp = toggleSelectAllComp;
window.showBulkDeleteCompModal = showBulkDeleteCompModal;
window.closeBulkDeleteCompModal = closeBulkDeleteCompModal;
window.confirmBulkDeleteComp = confirmBulkDeleteComp;

// Show confirmation modal that returns a Promise (replaces browser confirm())
function showConfirmModal(title, message, type = 'warning') {
  return new Promise((resolve) => {
    // Remove existing modal if present
    const existingModal = document.getElementById('compConfirmModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Determine icon and color based on type
    let icon, titleColor;
    if (type === 'warning') {
      icon = '⚠️';
      titleColor = '#ffc107';
    } else if (type === 'error') {
      icon = '❌';
      titleColor = '#dc3545';
    } else {
      icon = 'ℹ️';
      titleColor = '#0dcaf0';
    }
    
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'compConfirmModal';
    modal.className = 'modal';
    modal.style.cssText = 'display: flex; z-index: 10001;';
    
    // Create modal content
    modal.innerHTML = `
      <div class="modal-content" style="max-width:450px; text-align:center;">
        <div style="font-size:3rem; margin-bottom:1rem; color:${titleColor};">${icon}</div>
        <h3 style="margin:0 0 0.75rem; color:${titleColor};">${title}</h3>
        <p style="margin:0 0 1.5rem; color:#ccc; white-space:pre-wrap; text-align:left; font-size:0.9rem;">${message}</p>
        <div style="display:flex; gap:0.75rem; justify-content:center;">
          <button type="button" id="compConfirmCancelBtn" style="background:linear-gradient(135deg, #4a5568 0%, #2d3748 100%); color:#fff; border:none; border-radius:8px; padding:0.65rem 1.5rem; font-size:0.9rem; font-weight:500; cursor:pointer;">Cancel</button>
          <button type="button" id="compConfirmProceedBtn" class="btn-primary" style="background:linear-gradient(135deg, #dc3545 0%, #b02a37 100%); border-radius:8px; padding:0.65rem 1.5rem; font-size:0.9rem;">Proceed Anyway</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle button clicks
    document.getElementById('compConfirmCancelBtn').onclick = () => {
      modal.remove();
      resolve(false);
    };
    
    document.getElementById('compConfirmProceedBtn').onclick = () => {
      modal.remove();
      resolve(true);
    };
    
    // Close modal on overlay click (treat as cancel)
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    };
  });
}

// Show notification as pop-up modal (matching employee directory style)
function showNotification(message, type = 'info') {
  // Remove existing notification modal if present
  const existingModal = document.getElementById('compNotificationModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Determine icon and title based on type
  let icon, titleText, titleColor;
  if (type === 'success') {
    icon = '✅';
    titleText = 'Success';
    titleColor = '#16a34a';
  } else if (type === 'error') {
    icon = '❌';
    titleText = 'Error';
    titleColor = '#ea580c';
  } else if (type === 'warning') {
    icon = '⚠️';
    titleText = 'Warning';
    titleColor = '#ffc107';
  } else {
    icon = 'ℹ️';
    titleText = 'Info';
    titleColor = '#2563eb';
  }
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'compNotificationModal';
  modal.className = 'modal';
  modal.style.cssText = 'display: flex;';
  
  // Create modal content (matching employee directory style)
  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px; text-align:center;">
      <div style="font-size:3rem; margin-bottom:1rem; color:${titleColor};">${icon}</div>
      <h3 style="margin:0 0 0.5rem; color:${titleColor};">${titleText}</h3>
      <p style="margin:0 0 1.5rem; color:#ccc;">${message}</p>
      <button class="btn-primary" id="compNotificationCloseBtn">OK</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close modal on button click
  const closeBtn = document.getElementById('compNotificationCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
  }
  
  // Close modal on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Auto-close after 3 seconds for success/info, keep error open
  if (type !== 'error') {
    setTimeout(() => {
      if (document.getElementById('compNotificationModal')) {
        modal.remove();
      }
    }, 3000);
  }
}

// Apply filters
function applyCompensationFilters() {
  const nameFilter = document.getElementById('compNameFilter')?.value.toLowerCase() || '';
  const departmentFilter = document.getElementById('compDepartmentFilter')?.value || '';
  const contractFilter = document.getElementById('compContractFilter')?.value || '';
  const statusFilter = document.getElementById('compStatusFilter')?.value || '';
  
  // Filter employees directly (employees are now the data source)
  const employeesData = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp || [];
  
  filteredCompensations = employeesData.filter(emp => {
    // Build full name for search
    const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
    const suffix = emp.suffix || '';
    const empName = ((emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ')).toLowerCase();
    const empDepartment = emp.department || '';
    const empContract = emp.employmentType || '';
    const empStatus = emp.employmentStatus || '';
    
    // Match name filter (search by employee name or ID)
    if (nameFilter && !empName.includes(nameFilter) && !(emp.employeeId || '').toLowerCase().includes(nameFilter)) {
      return false;
    }
    
    // Match department filter
    if (departmentFilter && empDepartment !== departmentFilter) {
      return false;
    }
    
    // Match contract type filter
    if (contractFilter && empContract !== contractFilter) {
      return false;
    }
    
    // Match status filter
    if (statusFilter && empStatus !== statusFilter) {
      return false;
    }
    
    return true;
  });
  
  compCurrentPage = 1;
  renderCompensationsPage();
  
  // Update filter summary
  const sum = document.getElementById('compFilterSummary');
  if (sum) {
    const activeFilters = [nameFilter, departmentFilter, contractFilter, statusFilter].filter(f => f).length;
    sum.textContent = activeFilters > 0 
      ? `Showing ${filteredCompensations.length} employee(s) with ${activeFilters} filter(s) applied`
      : `Showing ${filteredCompensations.length} employee(s)`;
  }
}

// Expose globally
window.applyCompensationFilters = applyCompensationFilters;

// Clear filters
function clearCompensationFilters() {
  const nameFilter = document.getElementById('compNameFilter');
  const departmentFilter = document.getElementById('compDepartmentFilter');
  const contractFilter = document.getElementById('compContractFilter');
  const statusFilter = document.getElementById('compStatusFilter');
  
  if (nameFilter) nameFilter.value = '';
  if (departmentFilter) departmentFilter.value = '';
  if (contractFilter) contractFilter.value = '';
  if (statusFilter) statusFilter.value = '';
  
  // Reset to all employees
  filteredCompensations = [...(window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp)];
  compCurrentPage = 1;
  renderCompensationsPage();
  
  // Update filter summary
  const sum = document.getElementById('compFilterSummary');
  if (sum) sum.textContent = `Showing ${filteredCompensations.length} employee(s)`;
}

// Expose globally
window.clearCompensationFilters = clearCompensationFilters;

// ===== ADD COMPENSATION MODAL FUNCTIONS =====

// Load employees for the dropdown
async function loadEmployeesForComp() {
  try {
    // Fetch employees from the Employee Directory table using centralized config
    const AIRTABLE_API_KEY = AIRTABLE_CONFIG.API_KEY;
    const BASE_ID = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(AIRTABLE_CONFIG.TABLES.EMPLOYEE_DIRECTORY)}?view=Grid%20view`;
    
    // Fetch all records with pagination support
    let allRecords = [];
    let fetchUrl = baseUrl;
    
    while (fetchUrl) {
      const res = await fetch(fetchUrl, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch employees');
      }
      
      const data = await res.json();
      allRecords = allRecords.concat(data.records || []);
      
      // Handle pagination
      if (data.offset) {
        fetchUrl = baseUrl + '&offset=' + data.offset;
      } else {
        fetchUrl = null;
      }
    }
    
    console.log('[CompBenefits] Loaded', allRecords.length, 'employees');
    
    allEmployeesForComp = allRecords.map(r => {
      const fields = r.fields || {};
      return {
        id: r.id,
        employeeId: fields.EmployeeId || '',
        name: fields.Name || '', // Full name field if available
        firstName: fields.FirstName || '',
        middleName: fields.MiddleName || '',
        lastName: fields.LastName || '',
        suffix: fields.Suffix || '', // Add suffix field
        department: fields.Department || '',
        positionTitle: fields.PositionTitle || fields.Position || '', // Position/Title
        jobLevel: fields.JobLevel || '', // Job Level
        baseSalary: fields.BaseSalary || fields.ContractSalary || 0, // Support both field names
        contractSalary: fields.ContractSalary || fields.BaseSalary || 0,
        allowance: fields.Allowance || fields.MonthlyAllowance || 0, // Support both field names
        monthlyAllowance: fields.MonthlyAllowance || fields.Allowance || 0,
        overtime: fields.Overtime || 0,
        rateType: fields.RateType || 'Fixed',
        standardWorkweekHours: fields.StandardWorkweekHours || 40,
        employmentType: fields.EmploymentType || '',
        employmentStatus: fields.EmploymentStatus || '',
        dateOfBirth: fields.DateOfBirth || null,  // For SSS age exemption (60+ years old are exempt)
        coreWorkingHours: fields.CoreWorkingHours || ''
      };
    });
    
    // Sync to window storage so it persists across tab switches
    window._compBenefitsData.allEmployeesForComp = allEmployeesForComp;
    
    return allEmployeesForComp;
  } catch (e) {
    console.error('Error loading employees for compensation:', e);
    return [];
  }
}

// Populate employee dropdown
function populateCompEmployeeDropdown(employees) {
  const select = document.getElementById('compEmployeeSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">-- Select Employee --</option>';
  
  // Sort employees alphabetically by last name, then first name
  const sortedEmployees = [...employees].sort((a, b) => {
    const lastNameA = (a.lastName || '').toLowerCase();
    const lastNameB = (b.lastName || '').toLowerCase();
    const firstNameA = (a.firstName || '').toLowerCase();
    const firstNameB = (b.firstName || '').toLowerCase();
    if (lastNameA !== lastNameB) {
      return lastNameA.localeCompare(lastNameB);
    }
    return firstNameA.localeCompare(firstNameB);
  });
  
  sortedEmployees.forEach(emp => {
    const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
    const suffix = emp.suffix || '';
    const fullName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
    const option = document.createElement('option');
    option.value = emp.employeeId;
    option.textContent = `${fullName} (${emp.employeeId}) - ${emp.department}`;
    option.dataset.employee = JSON.stringify(emp);
    select.appendChild(option);
  });
  
  // Use onchange property to ensure only one listener (overwrites any previous)
  select.onchange = updateCompEmployeeInfo;
  console.log('[CompBenefits] Employee dropdown populated with', sortedEmployees.length, 'employees');
}

// Show Add Compensation Modal
async function showAddCompensationModal() {
  const modal = document.getElementById('addCompensationModal');
  if (!modal) return;
  
  // Reset form
  const form = document.getElementById('addCompensationForm');
  if (form) form.reset();
  
  // Reset employee header
  const empHeader = document.getElementById('compEmployeeHeader');
  if (empHeader) empHeader.style.display = 'none';
  
  // Reset info text
  const infoText = document.getElementById('addCompEmployeeInfo');
  if (infoText) infoText.textContent = 'Select an employee first';
  
  // Reset totals
  resetCompTotals();
  
  // Load employees and populate dropdown
  const employees = await loadEmployeesForComp();
  populateCompEmployeeDropdown(employees);
  
  // Show modal
  modal.style.display = 'block';
}

// Close Add Compensation Modal
function closeAddCompensationModal() {
  const modal = document.getElementById('addCompensationModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Reset form
  const form = document.getElementById('addCompensationForm');
  if (form) form.reset();
  
  // Reset employee header
  const empHeader = document.getElementById('compEmployeeHeader');
  if (empHeader) empHeader.style.display = 'none';
  
  // Reset totals
  resetCompTotals();
}

// Calculate age from date of birth
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Show or hide SSS age exemption banner
function updateSSSAgeBanner(dateOfBirth) {
  const banner = document.getElementById('sssAgeExemptionBanner');
  if (!banner) return;
  
  const age = calculateAge(dateOfBirth);
  if (age !== null && age >= 60) {
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

// Show or hide Pag-IBIG age exemption banner
function updatePagIBIGAgeBanner(dateOfBirth) {
  const banner = document.getElementById('pagibigAgeExemptionBanner');
  if (!banner) return;
  
  const age = calculateAge(dateOfBirth);
  if (age !== null && age >= 60) {
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

// Update employee info when selection changes
async function updateCompEmployeeInfo() {
  const select = document.getElementById('compEmployeeSelect');
  if (!select || !select.value) {
    // Reset if no selection
    const empHeader = document.getElementById('compEmployeeHeader');
    if (empHeader) empHeader.style.display = 'none';
    
    // Hide SSS age exemption banner
    const sssBanner = document.getElementById('sssAgeExemptionBanner');
    if (sssBanner) sssBanner.style.display = 'none';
    
    // Hide Pag-IBIG age exemption banner
    const pagibigBanner = document.getElementById('pagibigAgeExemptionBanner');
    if (pagibigBanner) pagibigBanner.style.display = 'none';
    
    const infoText = document.getElementById('addCompEmployeeInfo');
    if (infoText) infoText.textContent = 'Select an employee first';
    
    resetCompTotals();
    return;
  }
  
  const selectedOption = select.options[select.selectedIndex];
  const empData = JSON.parse(selectedOption.dataset.employee || '{}');
  
  // Update employee header
  const empHeader = document.getElementById('compEmployeeHeader');
  const initials = document.getElementById('compEmployeeInitials');
  const nameHeader = document.getElementById('compEmployeeNameHeader');
  const idHeader = document.getElementById('compEmployeeIdHeader');
  const deptHeader = document.getElementById('compEmployeeDeptHeader');
  const rateHeader = document.getElementById('compEmployeeRateHeader');
  
  if (empHeader) empHeader.style.display = 'block';
  
  const middleInitial = empData.middleName ? `${empData.middleName.charAt(0)}.` : '';
  const fullName = (empData.lastName || '') + (empData.firstName || middleInitial ? ', ' : '') + [empData.firstName || '', middleInitial].filter(n => n).join(' ');
  const initialsStr = `${(empData.lastName || '?')[0]}${(empData.firstName || '?')[0]}`.toUpperCase();
  
  if (initials) initials.textContent = initialsStr;
  if (nameHeader) nameHeader.textContent = fullName;
  if (idHeader) idHeader.textContent = `ID: ${empData.employeeId}`;
  if (deptHeader) deptHeader.textContent = `Department: ${empData.department}`;
  if (rateHeader) rateHeader.textContent = `Rate Type: ${empData.rateType || 'Fixed'}`;
  
  // Update info text
  const infoText = document.getElementById('addCompEmployeeInfo');
  if (infoText) infoText.textContent = `${fullName} - ${empData.department}`;
  
  // Set hidden employee ID
  const hiddenId = document.getElementById('addCompEmployeeId');
  if (hiddenId) hiddenId.value = empData.employeeId;
  
  // Check and show SSS age exemption banner for employees 60+
  updateSSSAgeBanner(empData.dateOfBirth);
  
  // Check and show Pag-IBIG age exemption banner for employees 60+
  updatePagIBIGAgeBanner(empData.dateOfBirth);
  
  // Populate payroll fields from employee data (async to fetch SSS from Airtable)
  await populateCompPayrollFields(empData);
}

// Populate payroll fields based on employee data
async function populateCompPayrollFields(empData) {
  const baseSalaryInput = document.getElementById('addCompBaseSalary');
  const allowancesInput = document.getElementById('addCompAllowances');
  const overtimeInput = document.getElementById('addCompOvertime');
  const overtimeNote = document.getElementById('compOvertimeNote');
  const sssInput = document.getElementById('addCompSSS');
  
  const baseSalary = parseFloat(empData.baseSalary) || 0;
  const allowance = parseFloat(empData.allowance) || 0;
  
  // Set base salary from employee record
  if (baseSalaryInput) {
    baseSalaryInput.value = baseSalary.toFixed(2);
  }
  
  // Set allowances from employee record
  if (allowancesInput) {
    allowancesInput.value = allowance.toFixed(2);
  }
  
  // Handle overtime - calculate overtime rate
  if (overtimeInput) {
    if (empData.rateType === 'Fixed') {
      overtimeInput.value = '0.00';
      overtimeInput.disabled = true;
      if (overtimeNote) overtimeNote.style.display = 'block';
    } else {
      // Calculate overtime rate (hourly rate × 1.25)
      const overtimeRate = calculateOvertimeRate(empData.employeeId);
      overtimeInput.value = overtimeRate.toFixed(2);
      overtimeInput.disabled = false;
      if (overtimeNote) overtimeNote.style.display = 'none';
    }
  }
  
  // Calculate ALL deductions using GovContributions module (same as Daily Breakdown)
  await calculateAndShowAllDeductions(empData, baseSalary, allowance);
  
  // Calculate totals
  calculateCompTotals();
}

// Calculate and display all government deductions using GovContributions module
async function calculateAndShowAllDeductions(empData, baseSalary, allowance) {
  const sssInput = document.getElementById('addCompSSS');
  const philHealthInput = document.getElementById('addCompPhilHealth');
  const pagIbigInput = document.getElementById('addCompPagIbig');
  const taxInput = document.getElementById('addCompTax');
  
  // Reset all to 0 first
  if (sssInput) sssInput.value = '0.00';
  if (philHealthInput) philHealthInput.value = '0.00';
  if (pagIbigInput) pagIbigInput.value = '0.00';
  if (taxInput) taxInput.value = '0.00';
  
  // Check if GovContributions module is available
  if (!window.GovContributions || !window.GovContributions.calculateAllContributions) {
    console.warn('[AddPayroll] GovContributions module not available, falling back to SSS table');
    // Fallback to old SSS-only logic
    if (sssInput) {
      const sssContribution = await fetchSSSEmployeeContribution(empData.employeeId);
      sssInput.value = sssContribution.toFixed(2);
    }
    return;
  }
  
  try {
    // Calculate contributions using the proper module (same as Daily Breakdown)
    // Pass dateOfBirth for SSS age exemption check (60+ years old are exempt)
    const contributions = window.GovContributions.calculateAllContributions({
      contractBasicSalary: baseSalary,      // Monthly contract salary
      earnedBasicSalary: baseSalary,        // Assume full month
      overtimePay: 0,                       // Preview assumes no OT
      otherEarnings: allowance,             // Include allowance
      frequency: 'monthly',                 // Preview uses monthly rate
      dateOfBirth: empData?.dateOfBirth || null
    });
    
    console.log('[AddPayroll] Calculated contributions:', contributions);
    
    // Update the deduction fields
    if (sssInput && contributions.sss) {
      sssInput.value = contributions.sss.employee.toFixed(2);
    }
    if (philHealthInput && contributions.philHealth) {
      philHealthInput.value = contributions.philHealth.employee.toFixed(2);
    }
    if (pagIbigInput && contributions.pagIbig) {
      pagIbigInput.value = contributions.pagIbig.employee.toFixed(2);
    }
    if (taxInput && contributions.bir) {
      taxInput.value = contributions.bir.tax.toFixed(2);
    }
    
  } catch (err) {
    console.error('[AddPayroll] Error calculating deductions:', err);
    // Fallback to SSS table
    if (sssInput) {
      const sssContribution = await fetchSSSEmployeeContribution(empData.employeeId);
      sssInput.value = sssContribution.toFixed(2);
    }
  }
}

// Calculate Overtime Rate based on employee data (matches attendance.js calculation)
function calculateOvertimeRate(employeeId) {
  if (!employeeId) return 0;
  
  try {
    // Get employee data for hourly rate calculation - use window storage
    const employees = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
    const emp = employees.find(e => e.employeeId === employeeId);
    if (!emp) {
      console.log(`Employee data not found for ${employeeId}`);
      return 0;
    }
    
    // Fixed rate employees don't have overtime
    const rateType = (emp.rateType || 'Time-based').toLowerCase();
    if (rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary')) {
      return 0;
    }
    
    // Calculate hourly rate: (BaseSalary / 30) / (StandardWorkweekHours / workDaysPerWeek)
    // This matches the formula in attendance.js calculateHourlyRate()
    const baseSalary = parseFloat(emp.baseSalary) || 0;
    if (!baseSalary) return 0;
    
    const standardWorkweekHours = parseFloat(emp.standardWorkweekHours) || 40;
    // Time-based employees use 7-day calculation for overtime
    // Note: This function is only called for time-based employees (fixed returns 0 above)
    // Time-based employees don't subtract lunch break from standard hours
    // because they're paid for actual hours worked
    const dailyStandardHours = standardWorkweekHours / 7;
    const dailyRate = baseSalary / 30;
    const hourlyRate = dailyRate / dailyStandardHours;
    
    // Overtime rate = hourlyRate × 1.25 (125% of regular rate)
    const overtimeRate = hourlyRate * 1.25;
    
    console.log(`Overtime Rate for ${employeeId}: ₱${overtimeRate.toFixed(2)}/hour (Regular: ₱${hourlyRate.toFixed(2)}/hour, StandardHours: ${standardWorkweekHours})`);
    return overtimeRate;
  } catch (e) {
    console.error('Error calculating overtime rate:', e);
    return 0;
  }
}

// Fetch SSS Employee Contribution from Airtable SSSContributionRecords table
async function fetchSSSEmployeeContribution(employeeId) {
  if (!employeeId) return 0;
  
  try {
    const AIRTABLE_API_KEY = AIRTABLE_CONFIG.API_KEY;
    const BASE_ID = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
    
    // Filter by employee ID and get the most recent contribution record
    const filterFormula = encodeURIComponent(`{SSSEmployeeId}='${employeeId}'`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${AIRTABLE_CONFIG.TABLES.SSS_CONTRIBUTION_RECORDS}?filterByFormula=${filterFormula}&sort%5B0%5D%5Bfield%5D=ApplicableMonth&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    
    if (!res.ok) {
      console.error('Failed to fetch SSS contribution:', res.status);
      return 0;
    }
    
    const data = await res.json();
    
    if (data.records && data.records.length > 0) {
      const record = data.records[0];
      const employeeContribution = parseFloat(record.fields.EmployeeContribution) || 0;
      console.log(`SSS Employee Contribution for ${employeeId}:`, employeeContribution);
      return employeeContribution;
    }
    
    console.log(`No SSS contribution record found for ${employeeId}`);
    return 0;
  } catch (e) {
    console.error('Error fetching SSS contribution:', e);
    return 0;
  }
}

// Calculate totals - now includes ALL deductions
function calculateCompTotals() {
  const baseSalary = parseFloat(document.getElementById('addCompBaseSalary')?.value) || 0;
  const allowances = parseFloat(document.getElementById('addCompAllowances')?.value) || 0;
  const overtime = parseFloat(document.getElementById('addCompOvertime')?.value) || 0;
  
  // Get ALL deductions
  const sss = parseFloat(document.getElementById('addCompSSS')?.value) || 0;
  const philHealth = parseFloat(document.getElementById('addCompPhilHealth')?.value) || 0;
  const pagIbig = parseFloat(document.getElementById('addCompPagIbig')?.value) || 0;
  const tax = parseFloat(document.getElementById('addCompTax')?.value) || 0;
  
  const grossPay = baseSalary + allowances + overtime;
  const totalDeductions = sss + philHealth + pagIbig + tax;
  const netPay = grossPay - totalDeductions;
  
  const grossPayInput = document.getElementById('addCompGrossPay');
  const totalDeductionsInput = document.getElementById('addCompTotalDeductions');
  const netPayInput = document.getElementById('addCompNetPay');
  
  if (grossPayInput) grossPayInput.value = grossPay.toFixed(2);
  if (totalDeductionsInput) totalDeductionsInput.value = totalDeductions.toFixed(2);
  if (netPayInput) netPayInput.value = netPay.toFixed(2);
}

// Reset totals to zero
function resetCompTotals() {
  const fields = ['addCompBaseSalary', 'addCompAllowances', 'addCompOvertime', 'addCompSSS', 'addCompPhilHealth', 'addCompPagIbig', 'addCompTax', 'addCompGrossPay', 'addCompTotalDeductions', 'addCompNetPay'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '0.00';
  });
  
  // Reset overtime input state
  const overtimeInput = document.getElementById('addCompOvertime');
  if (overtimeInput) {
    overtimeInput.disabled = false;
  }
  
  const overtimeNote = document.getElementById('compOvertimeNote');
  if (overtimeNote) overtimeNote.style.display = 'none';
}

// Save compensation record
async function saveCompensationRecord(e) {
  // Always prevent default immediately to stop form submission
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Get submit button and show loading state
  const submitBtn = document.querySelector('#addCompensationForm button[type="submit"]');
  const originalBtnHTML = submitBtn?.innerHTML || '<span>✓</span> Add Payroll';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Adding Payroll...';
  }
  
  // Helper to reset button state
  const resetButton = () => {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHTML;
    }
  };
  
  const select = document.getElementById('compEmployeeSelect');
  if (!select || !select.value) {
    showNotification('Please select an employee first', 'error');
    resetButton();
    return false;
  }
  
  const selectedOption = select.options[select.selectedIndex];
  let empData = {};
  try {
    empData = JSON.parse(selectedOption.dataset.employee || '{}');
  } catch (parseErr) {
    console.error('Error parsing employee data:', parseErr);
    showNotification('Error: Invalid employee data. Please reselect the employee.', 'error');
    resetButton();
    return false;
  }
  
  const baseSalary = parseFloat(document.getElementById('addCompBaseSalary')?.value) || 0;
  const allowances = parseFloat(document.getElementById('addCompAllowances')?.value) || 0;
  const overtime = parseFloat(document.getElementById('addCompOvertime')?.value) || 0;
  
  // Get ALL deductions
  const sss = parseFloat(document.getElementById('addCompSSS')?.value) || 0;
  const philHealth = parseFloat(document.getElementById('addCompPhilHealth')?.value) || 0;
  const pagIbig = parseFloat(document.getElementById('addCompPagIbig')?.value) || 0;
  const tax = parseFloat(document.getElementById('addCompTax')?.value) || 0;
  const remarks = document.getElementById('addCompRemarks')?.value || '';
  
  const grossPay = baseSalary + allowances + overtime;
  const totalDeductions = sss + philHealth + pagIbig + tax;
  const netPay = grossPay - totalDeductions;
  
  const data = {
    employeeId: empData.employeeId,
    department: empData.department,
    baseSalary: baseSalary,
    allowances: allowances,
    overtime: overtime,
    grossPay: grossPay,
    deductions: totalDeductions,
    netPay: netPay,
    sssContribution: sss,
    philHealthContribution: philHealth,
    pagIbigContribution: pagIbig,
    withholdingTax: tax,
    remarks: remarks
  };
  
  try {
    // Check if createCompensationRecord exists
    if (!window.createCompensationRecord) {
      throw new Error('createCompensationRecord function not found');
    }
    
    // Validate employee data before saving
    if (!empData.employeeId) {
      showNotification('Error: Employee ID is missing. Please reselect the employee.', 'error');
      resetButton();
      return false;
    }
    
    const result = await window.createCompensationRecord(data);
    
    if (result) {
      showNotification('Payroll record added successfully', 'success');
      resetButton();
      closeAddCompensationModal();
      await loadCompensations(); // Refresh the table
      return false; // Prevent any form submission
    } else {
      showNotification('Failed to add payroll record', 'error');
      resetButton();
      return false;
    }
  } catch (e) {
    console.error('Error saving compensation:', e);
    showNotification('Error saving payroll record: ' + e.message, 'error');
    resetButton();
    return false;
  }
  
  return false; // Always return false to prevent form submission
}

// =====================================================
// DAILY BREAKDOWN MODAL FUNCTIONS
// =====================================================

// API Configuration for Attendance
const AIRTABLE_ATTENDANCE_TABLE = 'Attendances';

// Store current breakdown context
let currentBreakdownContext = {
  mode: 'create', // 'create' or 'edit'
  payrollId: null,
  employeeId: null,
  employeeName: null,
  employeeData: null
};

// Store current viewing breakdown data
let currentViewBreakdownData = null;

// Show Daily Breakdown Modal (Add Payroll Breakdown)
function showDailyBreakdownModal() {
  const modal = document.getElementById('dailyBreakdownModal');
  if (!modal) return;
  
  // Get current payroll employee info from view modal
  const empName = document.getElementById('viewCompEmpName')?.value || '';
  const empDept = document.getElementById('viewCompDept')?.value || '';
  const empId = document.getElementById('viewCompEmpId')?.value || '';
  
  // Find the employee data - use window storage
  const employees = window._compBenefitsData?.allEmployeesForComp || allEmployeesForComp;
  const employee = employees.find(e => e.employeeId === empId);
  
  // Set context
  currentBreakdownContext = {
    mode: 'create',
    payrollId: null,
    employeeId: empId,
    employeeName: empName,
    employeeData: employee || null
  };
  
  // Set employee header
  const header = document.getElementById('breakdownEmployeeHeader');
  if (header) header.style.display = 'flex';
  
  const initials = document.getElementById('breakdownEmpInitials');
  const nameEl = document.getElementById('breakdownEmpName');
  const deptEl = document.getElementById('breakdownEmpDept');
  const empIdEl = document.getElementById('breakdownEmpId');
  
  if (nameEl) nameEl.textContent = empName;
  if (deptEl) deptEl.textContent = empDept;
  if (empIdEl) empIdEl.textContent = empId || 'N/A';
  if (initials) {
    const parts = empName.split(' ');
    initials.textContent = parts.length >= 2 
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : empName.substring(0, 2).toUpperCase();
  }
  
  // Set default period (current pay period - 1st to 15th or 16th to end of month)
  // IMPORTANT: Always use current date to avoid year mismatch issues
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const day = today.getDate();
  let startDate, endDate;
  
  if (day <= 15) {
    // 1st cutoff: 1st to 15th of current month
    startDate = new Date(currentYear, currentMonth, 1);
    endDate = new Date(currentYear, currentMonth, 15);
  } else {
    // 2nd cutoff: 16th to end of current month
    startDate = new Date(currentYear, currentMonth, 16);
    endDate = new Date(currentYear, currentMonth + 1, 0); // Last day of current month
  }
  
  console.log('[Daily Breakdown] Setting period to current dates:', {
    today: today.toISOString().split('T')[0],
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0]
  });
  
  // Determine initial cutoff based on default period start date
  currentBreakdownContext.cutoff = startDate.getDate() <= 15 ? '1st' : '2nd';
  currentBreakdownContext.frequency = 'semi-monthly';
  
  // Format dates as YYYY-MM-DD strings for input fields
  // IMPORTANT: Use local date formatting to avoid timezone issues with toISOString()
  // toISOString() converts to UTC which can shift the date backwards in some timezones
  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  const startDateStr = formatDateLocal(startDate);
  const endDateStr = formatDateLocal(endDate);
  
  console.log('[Daily Breakdown] Formatted dates (local):', { startDateStr, endDateStr });
  
  // Get the original input elements
  const oldStartInput = document.getElementById('breakdownPeriodStart');
  const oldEndInput = document.getElementById('breakdownPeriodEnd');
  
  // NUCLEAR OPTION: Replace the input elements entirely to defeat browser autocomplete
  // This creates brand new elements that the browser can't match to cached data
  if (oldStartInput && oldStartInput.parentNode) {
    const newStartInput = document.createElement('input');
    newStartInput.type = 'date';
    newStartInput.id = 'breakdownPeriodStart';
    newStartInput.name = 'breakdownPeriodStart_' + Date.now(); // Unique name each time
    newStartInput.autocomplete = 'off';
    newStartInput.setAttribute('data-lpignore', 'true');
    newStartInput.style.cssText = oldStartInput.style.cssText;
    newStartInput.value = startDateStr;
    oldStartInput.parentNode.replaceChild(newStartInput, oldStartInput);
  }
  
  if (oldEndInput && oldEndInput.parentNode) {
    const newEndInput = document.createElement('input');
    newEndInput.type = 'date';
    newEndInput.id = 'breakdownPeriodEnd';
    newEndInput.name = 'breakdownPeriodEnd_' + Date.now(); // Unique name each time
    newEndInput.autocomplete = 'off';
    newEndInput.setAttribute('data-lpignore', 'true');
    newEndInput.style.cssText = oldEndInput.style.cssText;
    newEndInput.value = endDateStr;
    oldEndInput.parentNode.replaceChild(newEndInput, oldEndInput);
  }
  
  // Get references to the new inputs
  const startInput = document.getElementById('breakdownPeriodStart');
  const endInput = document.getElementById('breakdownPeriodEnd');
  
  // Define named handler functions for proper removal
  function handleStartDateChange() {
    const newStart = new Date(startInput.value);
    currentBreakdownContext.cutoff = newStart.getDate() <= 15 ? '1st' : '2nd';
    loadSalaryAdvancesForBreakdown();
  }
  
  function handleEndDateChange() {
    loadSalaryAdvancesForBreakdown();
  }
  
  // Attach change handlers to new inputs
  if (startInput) {
    startInput.onchange = handleStartDateChange;
  }
  if (endInput) {
    endInput.onchange = handleEndDateChange;
  }
  
  console.log('[Daily Breakdown] Inputs replaced with fresh elements. Dates set to:', startDateStr, 'to', endDateStr);
  
  // Calculate and display rate information
  const empData = currentBreakdownContext.employeeData;
  const baseSalary = empData?.baseSalary || 0;
  const standardWorkweekHours = empData?.standardWorkweekHours || 40;
  const rateType = empData?.rateType || 'Time-based';
  const isFixedRate = rateType === 'Fixed';
  
  // Store rate type in context for use in loadBreakdownAttendance
  currentBreakdownContext.isFixedRate = isFixedRate;
  
  const dailyRate = baseSalary / 30;
  // Daily standard hours = Standard Workweek Hours / 7 days
  const dailyStandardHours = standardWorkweekHours / 7;
  const hourlyRate = dailyStandardHours > 0 ? dailyRate / dailyStandardHours : 0;
  const overtimeRate = isFixedRate ? 0 : hourlyRate * 1.25;
  
  // Calculate work days in selected period based on rate type
  // Fixed: Count ALL calendar days (including Sundays)
  // Time-based: Will be updated after attendance is loaded (count present days)
  let workDays;
  if (isFixedRate) {
    workDays = calculateAllDaysInPeriod(startDate, endDate);
  } else {
    workDays = '--'; // Placeholder until attendance is loaded
  }
  
  // Update rate display elements
  updateElement('breakdownDailyRate', `₱${dailyRate.toFixed(2)}`);
  updateElement('breakdownHourlyRate', `₱${hourlyRate.toFixed(2)}`);
  updateElement('breakdownOTRate', isFixedRate ? 'N/A' : `₱${overtimeRate.toFixed(2)}`);
  updateElement('breakdownWorkDays', workDays);
  updateElement('breakdownEmpType', rateType);
  
  // Reset attendance table and summary
  resetBreakdownSummary();
  
  // Reset exclude all deductions toggle to INCLUDE (default)
  const excludeInput = document.getElementById('excludeAllDeductions');
  if (excludeInput) excludeInput.value = 'false';
  const excludeNote = document.getElementById('excludeDeductionsNote');
  if (excludeNote) excludeNote.style.display = 'none';
  const btnInclude = document.getElementById('btnIncludeDeductions');
  const btnExclude = document.getElementById('btnExcludeDeductions');
  if (btnInclude) {
    btnInclude.style.background = '#28a745';
    btnInclude.style.color = '#fff';
    btnInclude.style.borderColor = '#28a745';
  }
  if (btnExclude) {
    btnExclude.style.background = 'transparent';
    btnExclude.style.color = '#6c757d';
    btnExclude.style.borderColor = '#6c757d';
  }
  
  // Load salary advances for this employee
  loadSalaryAdvancesForBreakdown();
  
  modal.style.display = 'block';
}

// Calculate work days in a period (Monday to Saturday)
function calculateWorkDaysInPeriod(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let workDays = 0;
  
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const dayOfWeek = date.getDay();
    // Monday (1) to Saturday (6) are work days
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      workDays++;
    }
  }
  return workDays;
}

// Calculate ALL calendar days in a period (including Sundays) for Fixed employees
function calculateAllDaysInPeriod(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
  return diffDays;
}

// Close Daily Breakdown Modal
function closeDailyBreakdownModal() {
  const modal = document.getElementById('dailyBreakdownModal');
  if (modal) modal.style.display = 'none';
  
  // Reset context
  currentBreakdownContext = {
    mode: 'create',
    payrollId: null,
    employeeId: null,
    employeeName: null,
    employeeData: null
  };
  
  // Reset salary advance state
  currentAdvanceDeductionData = {
    outstandingBalance: 0,
    deductionAmount: 0,
    transactions: []
  };
}

// ===== SALARY ADVANCE DEDUCTION MANAGEMENT =====

// Store current advance deduction data
let currentAdvanceDeductionData = {
  outstandingBalance: 0,
  deductionAmount: 0,
  transactions: []
};

// Financial API configuration for salary advance transactions (using centralized config)
const FINANCIAL_BASE_ID = AIRTABLE_CONFIG.BASES.FINANCIAL;
const FINANCIAL_API_KEY = AIRTABLE_CONFIG.API_KEY;
const FINANCIAL_TABLE_NAME = AIRTABLE_CONFIG.TABLES.TRANSACTIONS;

// Fetch salary advances for an employee for the specific payroll month only
// Only counts advances (Cash Out) made within the same month as the period
// Uses Employee ID for reliable matching (stored in Item Name field)
async function fetchEmployeeAdvances(employeeId, periodStartDate = null, periodEndDate = null) {
  try {
    const url = `https://api.airtable.com/v0/${FINANCIAL_BASE_ID}/${encodeURIComponent(FINANCIAL_TABLE_NAME)}`;
    
    let allRecords = [];
    let offset = null;
    
    // Use the actual period dates for filtering (respects cutoff selection)
    let filterStartDate = null;
    let filterEndDate = null;
    if (periodStartDate && periodEndDate) {
      filterStartDate = periodStartDate;
      filterEndDate = periodEndDate;
    } else if (periodEndDate) {
      // Fallback: determine dates from period end
      const periodDate = new Date(periodEndDate);
      filterStartDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1).toISOString().split('T')[0];
      filterEndDate = periodEndDate;
    }
    
    console.log('[SalaryAdvance] Searching for employee by ID:', employeeId, 'Period:', filterStartDate, 'to', filterEndDate);
    
    do {
      let fetchUrl = url;
      const params = new URLSearchParams();
      
      // Filter for Salary Advance transactions by Employee ID (stored in Item Name field)
      let filterFormula;
      if (filterStartDate && filterEndDate) {
        // Filter by Employee ID and date range (cutoff period)
        filterFormula = `AND({Expense Type} = "Salary Advance", {Type} = "Cash Out", {Item Name} = "${employeeId}", IS_AFTER({Date}, DATEADD("${filterStartDate}", -1, 'days')), IS_BEFORE({Date}, DATEADD("${filterEndDate}", 1, 'days')))`;
      } else {
        // Filter by Employee ID only
        filterFormula = `AND({Expense Type} = "Salary Advance", {Type} = "Cash Out", {Item Name} = "${employeeId}")`;
      }
      
      console.log('[SalaryAdvance] Filter formula:', filterFormula);
      
      params.append('filterByFormula', filterFormula);
      
      if (offset) {
        params.append('offset', offset);
      }
      
      fetchUrl += '?' + params.toString();
      
      const response = await fetch(fetchUrl, {
        headers: {
          'Authorization': `Bearer ${FINANCIAL_API_KEY}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch advances: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[SalaryAdvance] Records found:', data.records?.length || 0);
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
      
    } while (offset);
    
    console.log('[SalaryAdvance] Total records for employee:', allRecords.length);
    if (allRecords.length > 0) {
      console.log('[SalaryAdvance] Sample record:', allRecords[0].fields);
    }
    
    // Calculate total advances for the month
    let totalAdvances = 0;
    const advanceTransactions = [];
    
    allRecords.forEach(record => {
      const fields = record.fields || {};
      const amount = parseFloat(fields.Amount) || 0;
      const date = fields.Date || '';
      
      totalAdvances += amount;
      advanceTransactions.push({ id: record.id, date, amount, type: 'Cash Out' });
    });
    
    console.log('[SalaryAdvance] Total advances amount:', totalAdvances);
    
    return {
      transactions: allRecords,
      advanceTransactions,
      totalAdvances,
      // For deduction, we use total advances for the month (will be deducted this period)
      outstandingBalance: totalAdvances
    };
    
  } catch (error) {
    console.error('Error fetching employee advances:', error);
    return {
      transactions: [],
      advanceTransactions: [],
      totalAdvances: 0,
      outstandingBalance: 0
    };
  }
}

// Load salary advances for the current breakdown employee based on selected period
// Salary advances are deducted in the cutoff period when they were given
async function loadSalaryAdvancesForBreakdown() {
  const advanceLabel = document.getElementById('advanceOutstandingLabel');
  const advanceControls = document.getElementById('advanceDeductionControls');
  const noAdvanceMessage = document.getElementById('noAdvanceMessage');
  const advanceDeductionDisplay = document.getElementById('breakdownAdvanceDeduction');
  const skipCheckbox = document.getElementById('skipAdvanceDeduction');
  const advanceSection = document.getElementById('salaryAdvanceSection');
  
  if (!advanceLabel) return;
  
  advanceLabel.textContent = 'Loading...';
  if (advanceControls) advanceControls.style.display = 'none';
  if (noAdvanceMessage) noAdvanceMessage.style.display = 'none';
  
  const employeeId = currentBreakdownContext.employeeId;
  const employeeName = currentBreakdownContext.employeeName;
  if (!employeeId) {
    advanceLabel.textContent = '₱0.00';
    console.log('[SalaryAdvance] No employee ID available');
    return;
  }
  
  // Get the period start and end dates from the form to filter advances for this cutoff only
  const periodStartDate = document.getElementById('breakdownPeriodStart')?.value || null;
  const periodEndDate = document.getElementById('breakdownPeriodEnd')?.value || null;
  const advanceDeductionAmount = document.getElementById('advanceDeductionAmount');
  
  try {
    // Fetch advances based on Employee ID and period dates (only advances within this cutoff)
    const advanceData = await fetchEmployeeAdvances(employeeId, periodStartDate, periodEndDate);
    
    // Get table elements
    const advancesSummaryTable = document.getElementById('advancesSummaryTable');
    const advancesSummaryBody = document.getElementById('advancesSummaryBody');
    const btnPrintAdvances = document.getElementById('btnPrintAdvances');
    
    if (advanceData.outstandingBalance > 0) {
      // Has outstanding advance - auto-deduct full amount by default
      currentAdvanceDeductionData = {
        outstandingBalance: advanceData.outstandingBalance,
        deductionAmount: advanceData.outstandingBalance,  // Full amount automatically
        transactions: advanceData.transactions,
        advanceTransactions: advanceData.advanceTransactions,
        employeeName: employeeName,
        periodStart: periodStartDate,
        periodEnd: periodEndDate
      };
      
      advanceLabel.textContent = `₱${advanceData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;
      if (advanceControls) advanceControls.style.display = 'block';
      if (noAdvanceMessage) noAdvanceMessage.style.display = 'none';
      
      // Populate advances summary table
      if (advancesSummaryTable && advancesSummaryBody) {
        advancesSummaryTable.style.display = 'block';
        advancesSummaryBody.innerHTML = advanceData.advanceTransactions.map(adv => {
          const dateObj = new Date(adv.date);
          const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `
            <tr style="border-bottom:1px solid rgba(253,126,20,0.2);">
              <td style="padding:0.35rem; color:#fff;">${dateStr}</td>
              <td style="padding:0.35rem; text-align:right; color:#fd7e14; font-weight:500;">₱${adv.amount.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
            </tr>
          `;
        }).join('');
      }
      
      // Show print button
      if (btnPrintAdvances) btnPrintAdvances.style.display = 'inline-block';
      
      // Update deduction displays
      if (advanceDeductionDisplay) {
        advanceDeductionDisplay.textContent = `₱${advanceData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;
      }
      
      // Update button amount
      const deductBtnAmount = document.getElementById('deductBtnAmount');
      if (deductBtnAmount) {
        deductBtnAmount.textContent = advanceData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2});
      }
      
      // Set default state: DEDUCT is active
      setAdvanceDeduction(true);
      
      // Update totals and check warning immediately
      updateBreakdownTotals();
      checkAdvanceWarning();
      
    } else {
      // No outstanding advance
      currentAdvanceDeductionData = {
        outstandingBalance: 0,
        deductionAmount: 0,
        transactions: [],
        advanceTransactions: [],
        employeeName: employeeName,
        periodStart: periodStartDate,
        periodEnd: periodEndDate
      };
      
      advanceLabel.textContent = '₱0.00';
      if (advanceControls) advanceControls.style.display = 'none';
      if (noAdvanceMessage) {
        noAdvanceMessage.style.display = 'block';
        noAdvanceMessage.innerHTML = '<span style="color:#28a745; font-size:0.85rem;">✓ No advances this period</span>';
      }
      if (advanceDeductionDisplay) {
        advanceDeductionDisplay.textContent = '₱0.00';
      }
      
      // Hide table and print button
      if (advancesSummaryTable) advancesSummaryTable.style.display = 'none';
      if (btnPrintAdvances) btnPrintAdvances.style.display = 'none';
    }
    
  } catch (error) {
    console.error('Error loading salary advances:', error);
    advanceLabel.textContent = 'Error';
  }
}

// Toggle exclude all deductions (true = exclude, false = include)
function toggleExcludeAllDeductions(shouldExclude) {
  const btnInclude = document.getElementById('btnIncludeDeductions');
  const btnExclude = document.getElementById('btnExcludeDeductions');
  const excludeInput = document.getElementById('excludeAllDeductions');
  const excludeNote = document.getElementById('excludeDeductionsNote');
  
  // Update display elements
  const sssEl = document.getElementById('breakdownSSS');
  const philHealthEl = document.getElementById('breakdownPhilHealth');
  const pagIbigEl = document.getElementById('breakdownPagIbig');
  const withholdingTaxEl = document.getElementById('breakdownWithholdingTax');
  const govtTotalEl = document.getElementById('breakdownGovtTotal');
  
  if (shouldExclude) {
    // Exclude from all deductions
    if (excludeInput) excludeInput.value = 'true';
    if (excludeNote) excludeNote.style.display = 'block';
    
    // Update button styles - EXCLUDE active
    if (btnInclude) {
      btnInclude.style.background = 'transparent';
      btnInclude.style.color = '#6c757d';
      btnInclude.style.borderColor = '#6c757d';
    }
    if (btnExclude) {
      btnExclude.style.background = '#dc3545';
      btnExclude.style.color = '#fff';
      btnExclude.style.borderColor = '#dc3545';
    }
    
    // Set all government contributions to 0 on display
    if (sssEl) sssEl.textContent = '₱0.00';
    if (philHealthEl) philHealthEl.textContent = '₱0.00';
    if (pagIbigEl) pagIbigEl.textContent = '₱0.00';
    if (withholdingTaxEl) withholdingTaxEl.textContent = '₱0.00';
    if (govtTotalEl) govtTotalEl.textContent = '₱0.00';
    
    console.log('[ExcludeDeductions] All deductions excluded');
  } else {
    // Include deductions
    if (excludeInput) excludeInput.value = 'false';
    if (excludeNote) excludeNote.style.display = 'none';
    
    // Update button styles - INCLUDE active
    if (btnInclude) {
      btnInclude.style.background = '#28a745';
      btnInclude.style.color = '#fff';
      btnInclude.style.borderColor = '#28a745';
    }
    if (btnExclude) {
      btnExclude.style.background = 'transparent';
      btnExclude.style.color = '#6c757d';
      btnExclude.style.borderColor = '#6c757d';
    }
    
    // Restore government contributions from calculated data
    const calcData = currentBreakdownContext.calculatedData || {};
    const sss = calcData.sssContribution || 0;
    const philHealth = calcData.philHealthContribution || 0;
    const pagIbig = calcData.pagIbigContribution || 0;
    const withTax = calcData.withholdingTax || 0;
    const govtTotal = sss + philHealth + pagIbig + withTax;
    
    if (sssEl) sssEl.textContent = `₱${sss.toFixed(2)}`;
    if (philHealthEl) philHealthEl.textContent = `₱${philHealth.toFixed(2)}`;
    if (pagIbigEl) pagIbigEl.textContent = `₱${pagIbig.toFixed(2)}`;
    if (withholdingTaxEl) withholdingTaxEl.textContent = `₱${withTax.toFixed(2)}`;
    if (govtTotalEl) govtTotalEl.textContent = `₱${govtTotal.toFixed(2)}`;
    
    console.log('[ExcludeDeductions] Deductions included');
  }
  
  // Recalculate totals
  updateBreakdownTotals();
}

// Expose toggleExcludeAllDeductions globally
window.toggleExcludeAllDeductions = toggleExcludeAllDeductions;

// Set advance deduction state (true = deduct, false = skip)
function setAdvanceDeduction(shouldDeduct) {
  const btnDeduct = document.getElementById('btnDeductAdvance');
  const btnSkip = document.getElementById('btnSkipAdvance');
  const advanceDeductionDisplay = document.getElementById('breakdownAdvanceDeduction');
  const skipInput = document.getElementById('skipAdvanceDeduction');
  
  if (shouldDeduct) {
    // Deduct full amount
    currentAdvanceDeductionData.deductionAmount = currentAdvanceDeductionData.outstandingBalance;
    console.log('[DeductAdvance] Deduction set to', currentAdvanceDeductionData.outstandingBalance);
    
    if (advanceDeductionDisplay) {
      advanceDeductionDisplay.textContent = `₱${currentAdvanceDeductionData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;
    }
    if (skipInput) skipInput.value = 'false';
    
    // Update button styles - DEDUCT active
    if (btnDeduct) {
      btnDeduct.style.background = '#28a745';
      btnDeduct.style.color = '#fff';
      btnDeduct.style.borderColor = '#28a745';
    }
    if (btnSkip) {
      btnSkip.style.background = 'transparent';
      btnSkip.style.color = '#6c757d';
      btnSkip.style.borderColor = '#6c757d';
    }
  } else {
    // Skip deduction
    currentAdvanceDeductionData.deductionAmount = 0;
    console.log('[DeductAdvance] Deduction skipped');
    
    if (advanceDeductionDisplay) advanceDeductionDisplay.textContent = '₱0.00';
    if (skipInput) skipInput.value = 'true';
    
    // Update button styles - SKIP active
    if (btnDeduct) {
      btnDeduct.style.background = 'transparent';
      btnDeduct.style.color = '#6c757d';
      btnDeduct.style.borderColor = '#6c757d';
    }
    if (btnSkip) {
      btnSkip.style.background = '#dc3545';
      btnSkip.style.color = '#fff';
      btnSkip.style.borderColor = '#dc3545';
    }
  }
  
  updateBreakdownTotals();
  checkAdvanceWarning();
}

// Check if advance would make net pay negative
function checkAdvanceWarning() {
  const warning = document.getElementById('advanceWarning');
  if (!warning) return;
  
  const totalEarnings = currentBreakdownContext.calculatedData?.totalEarnings || 0;
  const sssContribution = currentBreakdownContext.calculatedData?.sssContribution || 0;
  const philHealthContribution = currentBreakdownContext.calculatedData?.philHealthContribution || 0;
  const pagIbigContribution = currentBreakdownContext.calculatedData?.pagIbigContribution || 0;
  const withholdingTax = currentBreakdownContext.calculatedData?.withholdingTax || 0;
  const govtTotal = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
  const advanceDeduction = currentAdvanceDeductionData.deductionAmount || 0;
  const netPay = totalEarnings - govtTotal - advanceDeduction;
  
  warning.style.display = netPay < 0 ? 'block' : 'none';
}

// Toggle salary advance deduction inclusion (legacy - keeping for compatibility)
function toggleAdvanceDeduction() {
  const currentlyDeducting = currentAdvanceDeductionData.deductionAmount > 0;
  setAdvanceDeduction(!currentlyDeducting);
}

// Update advance deduction amount (simplified - no manual input now)
function updateAdvanceDeduction() {
  // Now handled by buttons - this is just for compatibility
  updateBreakdownTotals();
  checkAdvanceWarning();
}

// Update breakdown totals including advance deduction
function updateBreakdownTotals() {
  console.log('[updateBreakdownTotals] Called');
  
  const advanceDeductionDisplay = document.getElementById('breakdownAdvanceDeduction');
  const totalDeductionsDisplay = document.getElementById('breakdownTotalDeductions');
  const netPayDisplay = document.getElementById('breakdownNetPay');
  const netFormulaDisplay = document.getElementById('breakdownNetFormula');
  
  const advanceDeduction = currentAdvanceDeductionData.deductionAmount || 0;
  console.log('[updateBreakdownTotals] advanceDeduction:', advanceDeduction);
  
  // Check if all deductions are excluded
  const excludeAllDeductions = document.getElementById('excludeAllDeductions')?.value === 'true';
  
  // Get all government contributions from calculated data
  let sssContribution = currentBreakdownContext.calculatedData?.sssContribution || 0;
  let philHealthContribution = currentBreakdownContext.calculatedData?.philHealthContribution || 0;
  let pagIbigContribution = currentBreakdownContext.calculatedData?.pagIbigContribution || 0;
  let withholdingTax = currentBreakdownContext.calculatedData?.withholdingTax || 0;
  
  // If excluded, set government contributions to 0
  if (excludeAllDeductions) {
    sssContribution = 0;
    philHealthContribution = 0;
    pagIbigContribution = 0;
    withholdingTax = 0;
    console.log('[updateBreakdownTotals] All deductions EXCLUDED');
  }
  
  const govtContributionsTotal = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
  
  const totalEarnings = currentBreakdownContext.calculatedData?.totalEarnings || 0;
  const otherDeductions = currentBreakdownContext.calculatedData?.otherDeductions || 0;
  
  // Total deductions = government contributions + salary advance + other deductions
  const totalDeductions = govtContributionsTotal + advanceDeduction + otherDeductions;
  const netPay = totalEarnings - totalDeductions;
  
  console.log('[updateBreakdownTotals] totalEarnings:', totalEarnings, 'govtTotal:', govtContributionsTotal, 'advanceDeduction:', advanceDeduction, 'totalDeductions:', totalDeductions);
  
  if (advanceDeductionDisplay) {
    advanceDeductionDisplay.textContent = `₱${advanceDeduction.toFixed(2)}`;
  }
  
  if (totalDeductionsDisplay) {
    totalDeductionsDisplay.textContent = `₱${totalDeductions.toFixed(2)}`;
    console.log('[updateBreakdownTotals] Updated totalDeductionsDisplay to:', `₱${totalDeductions.toFixed(2)}`);
  }
  
  if (netPayDisplay) {
    netPayDisplay.textContent = `₱${netPay.toFixed(2)}`;
    netPayDisplay.style.color = netPay < 0 ? '#dc3545' : '#0dcaf0';
  }
  
  if (netFormulaDisplay) {
    netFormulaDisplay.textContent = `₱${totalEarnings.toFixed(2)} - ₱${totalDeductions.toFixed(2)} = ₱${netPay.toFixed(2)}`;
  }
  
  // Update calculated data for save
  if (currentBreakdownContext.calculatedData) {
    currentBreakdownContext.calculatedData.advanceDeduction = advanceDeduction;
    currentBreakdownContext.calculatedData.totalDeductions = totalDeductions;
    currentBreakdownContext.calculatedData.netPay = netPay;
    currentBreakdownContext.calculatedData.excludeAllDeductions = excludeAllDeductions;
    // Store effective (possibly zeroed) contribution values
    currentBreakdownContext.calculatedData.effectiveSSSContribution = sssContribution;
    currentBreakdownContext.calculatedData.effectivePhilHealthContribution = philHealthContribution;
    currentBreakdownContext.calculatedData.effectivePagIbigContribution = pagIbigContribution;
    currentBreakdownContext.calculatedData.effectiveWithholdingTax = withholdingTax;
    currentBreakdownContext.calculatedData.effectiveGovtContributionsTotal = govtContributionsTotal;
  }
}

// NOTE: createAdvanceRepaymentTransaction removed
// Salary advances are tracked as follows:
// 1. Finance records Cash Out for "Salary Advance" with employee name
// 2. HR sees outstanding balance when processing payroll
// 3. HR deducts from net pay (saved in PayrollItems.SalaryAdvanceDeduction)
// 4. Finance sees deduction in PayrollItems when disbursing salary
// 5. Accrued payroll journal entry reflects the reduced cash outflow
// No separate "repayment" transaction needed - the deduction IS the repayment

// Load Breakdown Attendance from Airtable
async function loadBreakdownAttendance() {
  const startDate = document.getElementById('breakdownPeriodStart')?.value;
  const endDate = document.getElementById('breakdownPeriodEnd')?.value;
  const employeeId = currentBreakdownContext.employeeId;
  
  if (!employeeId) {
    showNotification('No employee selected', 'error');
    return;
  }
  
  if (!startDate || !endDate) {
    showNotification('Please select both start and end dates', 'error');
    return;
  }
  
  const tbody = document.getElementById('breakdownAttendanceBody');
  if (!tbody) return;
  
  // Show loading
  tbody.innerHTML = `
    <tr>
      <td colspan="9" style="text-align:center; padding:2rem; color:#888;">
        <div style="display:inline-block; width:20px; height:20px; border:2px solid #0dcaf0; border-radius:50%; border-top-color:transparent; animation:spin 1s linear infinite;"></div>
        <p style="margin-top:0.5rem;">Fetching attendance records...</p>
      </td>
    </tr>
  `;
  
  try {
    // Fetch attendance records from Airtable
    const attendanceRecords = await fetchAttendanceForEmployee(employeeId, startDate, endDate);
    
    if (!attendanceRecords || attendanceRecords.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:2rem; color:#888;">
            No attendance records found for the selected period.
          </td>
        </tr>
      `;
      resetBreakdownSummary();
      return;
    }
    
    // Sort by date
    attendanceRecords.sort((a, b) => new Date(a.fields.Date) - new Date(b.fields.Date));
    
    // Calculate rates (use lowercase properties from mapped allEmployeesForComp)
    const empData = currentBreakdownContext.employeeData;
    const baseSalary = empData?.baseSalary || 0;
    const standardWorkweekHours = empData?.standardWorkweekHours || 40;
    const isFixedRate = (empData?.rateType || 'Time-based') === 'Fixed';
    const coreWorkingHours = empData?.coreWorkingHours || '';
    
    const dailyRate = baseSalary / 30;
    // Daily standard hours = Standard Workweek Hours / 7 days
    // If Core Working Hours span equals daily standard and > 8 hrs, lunch break wasn't accounted for
    const scheduleSpan = getScheduleSpanHours(coreWorkingHours);
    const dailyFromWeekly = standardWorkweekHours / 7;
    let dailyStandardHours = dailyFromWeekly;
    const hasLunchAdjustment = scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8;
    if (hasLunchAdjustment) {
      dailyStandardHours = dailyFromWeekly - 1; // Subtract 1 hour for lunch
    }
    const hourlyRate = dailyStandardHours > 0 ? dailyRate / dailyStandardHours : 0;
    const overtimeRate = isFixedRate ? 0 : hourlyRate * 1.25;
    
    // Render attendance table
    let totalDays = 0;
    let totalRegHrs = 0;
    let totalOTHrs = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalInvalid = 0;
    let totalRegPay = 0;
    let totalOTPay = 0;
    let totalDoublePay = 0;
    let totalHalfDays = 0;
    let totalUndertime = 0;
    let totalPersonalLeaveUsed = 0;
    
    const rows = attendanceRecords.map(record => {
      const fields = record.fields;
      
      // Count personal leave used
      const leaveType = fields.LeaveType || '';
      if (leaveType === 'Personal') {
        totalPersonalLeaveUsed++;
      }
      const date = new Date(fields.Date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      
      const totalHoursWorked = parseFloat(fields.TotalHoursWorked || 0);
      const otHours = parseFloat(fields.OvertimeHours || 0);
      const lateMinutes = parseFloat(fields.LateMinutes || 0);
      const isDoublePay = fields.IsDoublePay || false;
      
      // Compute status based on AM/PM time pattern (same logic as attendance.js getStatus)
      const hasAM = !!(fields.TimeInAM && fields.TimeOutAM);
      const hasPM = !!(fields.TimeInPM && fields.TimeOutPM);
      const isAbsent = !hasAM && !hasPM;
      const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM);
      
      // Minimum hours thresholds (same as attendance.js)
      const minHoursForHalfDay = dailyStandardHours / 2 * 0.75; // At least 75% of half day
      const minHoursForValid = 0.5; // At least 30 minutes to count as valid work
      const tol = 0.01;
      
      let status;
      if (isAbsent) {
        status = 'Absent';
      } else if (isHalfDay) {
        // Only AM or PM - check if enough hours for Half Day
        if (totalHoursWorked < minHoursForValid) {
          status = 'Invalid'; // Too short to count (e.g., 5 minutes)
        } else if (totalHoursWorked < minHoursForHalfDay) {
          status = 'Undertime'; // Some work but not enough for half day
        } else {
          status = 'Half Day';
        }
      } else {
        // Both AM and PM present - check total hours
        if (totalHoursWorked < 0) {
          status = 'Invalid';
        } else if (totalHoursWorked < (dailyStandardHours - tol)) {
          status = 'Undertime';
        } else if (totalHoursWorked > (dailyStandardHours + tol)) {
          status = 'Overtime';
        } else {
          status = 'Present';
        }
      }
      
      // Regular hours for display - matching attendance.js
      // For time-based: min(total hours, daily standard hours) 
      // For display with lunch adjustment: add 1 hour back if applicable
      const displayTotalHours = hasLunchAdjustment ? totalHoursWorked + 1 : totalHoursWorked;
      const regHours = isFixedRate 
        ? (isAbsent ? 0 : (isHalfDay ? dailyStandardHours / 2 : dailyStandardHours))
        : Math.min(totalHoursWorked, dailyStandardHours);
      
      // Calculate Regular Pay based on rate type
      // For Fixed employees: full daily rate, half for half day, 0 for absent/invalid
      // For Time-based employees: regular hours × hourly rate
      let regPay;
      if (isFixedRate) {
        if (status === 'Absent' || status === 'Invalid') {
          regPay = 0;
        } else if (status === 'Half Day') {
          regPay = dailyRate / 2;
        } else {
          regPay = dailyRate; // Full daily rate regardless of late/undertime/overtime
        }
      } else {
        regPay = regHours * hourlyRate;
      }
      const otPay = isFixedRate ? 0 : otHours * overtimeRate;
      // Double Pay = matches the actual Regular Pay earned (not full daily rate)
      // If employee worked partial hours, double pay is based on actual earnings
      const dayDoublePay = isDoublePay ? regPay : 0;
      
      if (status === 'Present' || status === 'Late' || status === 'Overtime' || status === 'Undertime' || status === 'Half Day') {
        totalDays++;
        totalRegHrs += regHours;
        totalOTHrs += otHours;
        totalRegPay += regPay;
        totalOTPay += otPay;
        if (isDoublePay) totalDoublePay += dayDoublePay;
      }
      totalLate += lateMinutes;
      if (status === 'Absent') totalAbsent++;
      if (status === 'Invalid') totalInvalid++;
      if (status === 'Half Day') totalHalfDays++;
      if (status === 'Undertime') totalUndertime++;
      
      // Status color (same as attendance.js)
      let statusColor = '#16a34a'; // green for present
      if (status === 'Overtime') statusColor = '#2563eb';
      if (status === 'Undertime') statusColor = '#ea580c';
      if (status === 'Half Day') statusColor = '#ca8a04';
      if (status === 'Absent') statusColor = '#dc2626';
      if (status === 'Late') statusColor = '#ffc107';
      if (status === 'Leave') statusColor = '#0dcaf0';
      if (status === 'Invalid') statusColor = '#9333ea'; // Purple for invalid/too short
      
      // Format Time In (AM and PM)
      const timeInAM = formatTimeDisplay(fields.TimeInAM);
      const timeInPM = formatTimeDisplay(fields.TimeInPM);
      const timeInDisplay = timeInAM !== '-' || timeInPM !== '-' 
        ? `${timeInAM !== '-' ? timeInAM : '-'}<br>${timeInPM !== '-' ? timeInPM : '-'}`
        : '-';
      
      // Format Time Out (AM and PM)
      const timeOutAM = formatTimeDisplay(fields.TimeOutAM);
      const timeOutPM = formatTimeDisplay(fields.TimeOutPM);
      const timeOutDisplay = timeOutAM !== '-' || timeOutPM !== '-'
        ? `${timeOutAM !== '-' ? timeOutAM : '-'}<br>${timeOutPM !== '-' ? timeOutPM : '-'}`
        : '-';
      
      // For Invalid records, show grayed out (not calculated) but still readable
      const isInvalid = status === 'Invalid';
      const rowStyle = isInvalid 
        ? 'border-bottom:1px solid #275b48; opacity:0.6;' 
        : 'border-bottom:1px solid #275b48;';
      const payDisplay = isInvalid ? '₱0.00' : `₱${regPay.toFixed(2)}`;
      const otPayDisplay = isInvalid ? '₱0.00' : `₱${otPay.toFixed(2)}`;
      
      return `
        <tr style="${rowStyle}" data-status="${status}">
          <td style="padding:0.5rem; color:#fff;">${dateStr}</td>
          <td style="padding:0.5rem; text-align:center; color:#fff;">${timeInDisplay}</td>
          <td style="padding:0.5rem; text-align:center; color:#fff;">${timeOutDisplay}</td>
          <td style="padding:0.5rem; text-align:center; color:#fff;">${formatHoursMinutes(displayTotalHours)}</td>
          <td style="padding:0.5rem; text-align:center; color:${isInvalid ? '#888' : '#28a745'}; font-weight:500;">${payDisplay}</td>
          <td style="padding:0.5rem; text-align:center; color:#fff;">${otHours > 0 ? formatHoursMinutes(otHours) : '-'}</td>
          <td style="padding:0.5rem; text-align:center; color:${isInvalid ? '#888' : '#28a745'};">${otHours > 0 ? otPayDisplay : '-'}</td>
          <td style="padding:0.5rem; text-align:center; color:${isDoublePay ? '#d97706' : '#888'};">${isDoublePay ? '₱' + dayDoublePay.toFixed(2) : '-'}</td>
          <td style="padding:0.5rem; text-align:center;"><span style="color:${statusColor}; font-weight:500;">${status}${isInvalid ? ' ⚠️' : ''}</span></td>
        </tr>
      `;
    }).join('');
    
    tbody.innerHTML = rows;
    
    // Calculate deductions
    const lateDed = (totalLate / 60) * hourlyRate; // Convert minutes to hours
    const absentDed = totalAbsent * dailyRate;
    
    // Allowance calculation: x2 for full month (day 1 to last day), x1 for half month (cut-off)
    // Full month = starts on day 1 AND ends on last day of month (28/29/30/31)
    // Note: For semi-monthly payroll, ending on day 30 of a 31-day month is 2nd cut (1x), not full month
    const baseAllowance = empData?.allowance || 0; // Fetch from employee data
    const periodStartDay = new Date(startDate).getDate();
    const periodEndDateObj = new Date(endDate);
    const periodEndDay = periodEndDateObj.getDate();
    const lastDayOfMonth = new Date(periodEndDateObj.getFullYear(), periodEndDateObj.getMonth() + 1, 0).getDate();
    // Full month ONLY if start is day 1 AND end is exactly the last day of the month
    const isFullMonth = periodStartDay === 1 && periodEndDay === lastDayOfMonth;
    const allowanceMultiplier = isFullMonth ? 2 : 1;
    const allowance = baseAllowance * allowanceMultiplier;
    
    console.log('[Allowance Calculation]', {
      baseAllowance,
      periodStartDay,
      periodEndDay,
      lastDayOfMonth,
      isFullMonth,
      allowanceMultiplier,
      totalAllowance: allowance
    });
    
    // For FIXED rate employees, cap regular pay at base salary for full month
    // This prevents 31-day months from paying more than monthly salary
    if (isFixedRate && isFullMonth) {
      const maxRegularPay = baseSalary;
      if (totalRegPay > maxRegularPay) {
        console.log('[Fixed Rate Cap] Capping regular pay from', totalRegPay.toFixed(2), 'to', maxRegularPay.toFixed(2));
        totalRegPay = maxRegularPay;
      }
    }
    
    const doublePay = totalDoublePay; // Calculated from IsDoublePay days
    
    // Perfect Attendance Bonus: Only if no absents (half days and undertime are allowed)
    // Calculate expected working days in the period (Mon-Sat = 6 days per week)
    const start = new Date(startDate);
    const end = new Date(endDate);
    let expectedWorkingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      // Count Mon-Sat as working days (0=Sun, 6=Sat)
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        expectedWorkingDays++;
      }
    }
    
    // Check if this is 1st cut (ends on day 15 or earlier) or 2nd cut (ends on day 16+)
    const endDay = end.getDate();
    const is2ndCut = endDay >= 16;
    
    // Perfect attendance: no absents, no invalid records, AND totalDays >= expected working days
    // (half days and undertime are allowed, but invalid/too-short records are not)
    // IMPORTANT: Perfect attendance is ONLY paid on 2nd cut, but requires BOTH cuts to be perfect
    // If a record is deleted (missing date), totalDays will be less than expectedWorkingDays
    // Also count records with status 'Absent' as absent (even if they have a record)
    const hasCurrentPeriodPerfect = totalAbsent === 0 && totalInvalid === 0 && totalDays >= expectedWorkingDays && expectedWorkingDays > 0;
    
    // For 2nd cut, also check if 1st cut was perfect (for full month perfect attendance)
    let has1stCutPerfect = true;
    if (is2ndCut) {
      try {
        const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
        const firstCutEnd = new Date(end.getFullYear(), end.getMonth(), 15);
        const firstCutStartStr = monthStart.toISOString().split('T')[0];
        const firstCutEndStr = firstCutEnd.toISOString().split('T')[0];
        
        // Calculate expected working days for 1st cut
        let firstCutExpectedDays = 0;
        for (let d = new Date(monthStart); d <= firstCutEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay();
          if (dayOfWeek >= 1 && dayOfWeek <= 6) firstCutExpectedDays++;
        }
        
        // Fetch 1st cut attendance
        const firstCutRecords = await fetchAttendanceForEmployee(employeeId, firstCutStartStr, firstCutEndStr);
        if (firstCutRecords && firstCutRecords.length > 0) {
          const firstCutAbsents = firstCutRecords.filter(r => r.fields.Status === 'Absent' || r.fields.Status === 'absent').length;
          const firstCutInvalid = firstCutRecords.filter(r => r.fields.Status === 'Invalid' || r.fields.Status === 'invalid').length;
          const firstCutDays = firstCutRecords.length;
          has1stCutPerfect = firstCutAbsents === 0 && firstCutInvalid === 0 && firstCutDays >= firstCutExpectedDays;
          console.log('[Perfect Attendance] 1st Cut check:', { firstCutAbsents, firstCutInvalid, firstCutDays, firstCutExpectedDays, has1stCutPerfect });
        } else {
          has1stCutPerfect = false;
          console.log('[Perfect Attendance] No 1st cut records found - not perfect');
        }
      } catch (e) {
        console.warn('Could not fetch 1st cut attendance for perfect attendance check:', e);
        has1stCutPerfect = false;
      }
    }
    
    // Perfect attendance bonus: Only on 2nd cut AND both 1st and 2nd cut must be perfect
    const hasPerfectAttendance = is2ndCut && hasCurrentPeriodPerfect && has1stCutPerfect;
    const perfectAttendanceBonus = hasPerfectAttendance ? dailyRate : 0;
    
    console.log('[Perfect Attendance Debug]', {
      totalAbsent,
      totalInvalid,
      totalDays,
      expectedWorkingDays,
      is2ndCut,
      hasCurrentPeriodPerfect,
      has1stCutPerfect,
      hasPerfectAttendance,
      perfectAttendanceBonus,
      condition1_is2ndCut: is2ndCut,
      condition2_currentPerfect: hasCurrentPeriodPerfect,
      condition3_1stCutPerfect: has1stCutPerfect
    });
    
    // Leave Conversion: 1 personal leave allowed per month, if not used = daily rate bonus
    // Only apply on 2nd cut (16-30/31)
    // For 2nd cut, we need to check ALL personal leaves used in the entire month, not just this period
    const personalLeaveAllowedPerMonth = 1;
    let totalMonthPersonalLeaveUsed = totalPersonalLeaveUsed;
    
    // If this is the 2nd cut, also check for personal leaves in the 1st cut of the same month
    if (is2ndCut) {
      try {
        // Get the 1st day of the month for full month check
        const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
        const firstCutEnd = new Date(end.getFullYear(), end.getMonth(), 15);
        const firstCutStartStr = monthStart.toISOString().split('T')[0];
        const firstCutEndStr = firstCutEnd.toISOString().split('T')[0];
        
        // Fetch attendance for 1st cut to check for personal leaves
        const firstCutRecords = await fetchAttendanceForEmployee(employeeId, firstCutStartStr, firstCutEndStr);
        if (firstCutRecords && firstCutRecords.length > 0) {
          const firstCutPersonalLeaves = firstCutRecords.filter(r => r.fields.LeaveType === 'Personal').length;
          totalMonthPersonalLeaveUsed += firstCutPersonalLeaves;
          console.log('[Leave Conversion] 1st Cut personal leaves found:', firstCutPersonalLeaves);
        }
      } catch (e) {
        console.warn('Could not fetch 1st cut attendance for leave check:', e);
      }
    }
    
    const unusedPersonalLeave = is2ndCut ? Math.max(0, personalLeaveAllowedPerMonth - totalMonthPersonalLeaveUsed) : 0;
    const leaveConversionBonus = unusedPersonalLeave * dailyRate;
    
    console.log('[Cut Type Check]', {
      endDay,
      is2ndCut,
      message: is2ndCut ? '2nd Cut - Leave Conversion & Perfect Attendance apply (if full month is perfect)' : '1st Cut - Leave Conversion & Perfect Attendance do NOT apply (only on 2nd cut)'
    });
    
    console.log('[Perfect Attendance Check]', { 
      totalDays, 
      totalAbsent,
      totalInvalid,
      totalHalfDays,
      totalUndertime,
      expectedWorkingDays, 
      hasPerfectAttendance, 
      perfectAttendanceBonus: perfectAttendanceBonus.toFixed(2)
    });
    
    console.log('[Leave Conversion Check]', {
      totalPersonalLeaveUsed,
      totalMonthPersonalLeaveUsed,
      personalLeaveAllowedPerMonth,
      unusedPersonalLeave,
      leaveConversionBonus: leaveConversionBonus.toFixed(2)
    });
    
    // Calculate government contributions using GovContributions module
    // Get contract salary and earned salary for contribution calculations
    // Note: empData is already defined earlier in this function
    const contractBasicSalary = empData?.baseSalary || 0; // Monthly contract salary
    const earnedBasicSalary = totalRegPay; // Actual earned regular pay for this period
    const otherDeductions = 0; // No additional deductions
    const totalEarnings = totalRegPay + totalOTPay + allowance + doublePay + perfectAttendanceBonus + leaveConversionBonus;
    
    // Initialize government contributions
    let sssContribution = 0;
    let philHealthContribution = 0;
    let pagIbigContribution = 0;
    let withholdingTax = 0;
    let govtContributionsTotal = 0;
    
    // Employer contributions (for accounting/reporting purposes)
    let sssEmployer = 0;
    let philHealthEmployer = 0;
    let pagIbigEmployer = 0;
    
    // Determine if this is a semi-monthly or monthly period and which cutoff
    const periodStartStr = document.getElementById('breakdownPeriodStart')?.value;
    const periodEndStr = document.getElementById('breakdownPeriodEnd')?.value;
    const periodStart = new Date(periodStartStr);
    const periodEnd = new Date(periodEndStr);
    const periodDays = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24)) + 1;
    const frequency = periodDays <= 16 ? 'semi-monthly' : 'monthly';
    
    // Determine cutoff period: 1st (days 1-15) or 2nd (days 16-30)
    // Based on the START date of the period
    const cutoff = periodStart.getDate() <= 15 ? '1st' : '2nd';
    
    // Store cutoff in context for salary advance logic
    currentBreakdownContext.cutoff = cutoff;
    currentBreakdownContext.frequency = frequency;
    
    if (window.GovContributions) {
      // Calculate all contributions using the government contributions calculator
      // Pass cutoff so 1st cutoff = Tax only, 2nd cutoff = Full deductions
      // Pass dateOfBirth for SSS age exemption check (60+ years old are exempt)
      // Pass isPerCutoff=true because earnedBasicSalary is already the per-cutoff amount
      // 
      // NOTE: Allowance is treated as DE MINIMIS (non-taxable)
      // Perfect Attendance & Leave Conversion are BONUSES - tax-exempt up to ₱90,000/year (TRAIN Law)
      // Double Pay is also considered a bonus/incentive
      const contributions = window.GovContributions.calculateAllContributions({
        contractBasicSalary: contractBasicSalary,    // PhilHealth uses contract salary (MONTHLY)
        earnedBasicSalary: earnedBasicSalary,        // SSS uses earned salary (PER-CUTOFF)
        overtimePay: totalOTPay,
        otherEarnings: 0,  // Regular taxable allowances (not bonuses)
        deMinimis: allowance,  // Allowance treated as de minimis (NON-TAXABLE)
        bonuses: doublePay + perfectAttendanceBonus + leaveConversionBonus,  // Tax-exempt up to ₱90k/year
        yearToDateBonuses: 0,  // TODO: Track cumulative bonuses YTD from previous periods
        frequency: frequency,
        cutoff: cutoff,  // 1st = Tax only, 2nd = Full deductions
        isPerCutoff: true,  // Earnings are already per-cutoff, don't divide by 2 for tax
        dateOfBirth: empData?.dateOfBirth || null
      });
      
      // Use APPLIED values (respects cutoff logic: 1st = 0 for SSS/PH/PI, 2nd = full)
      sssContribution = contributions.appliedSSS.employee;
      philHealthContribution = contributions.appliedPhilHealth.employee;
      pagIbigContribution = contributions.appliedPagIbig.employee;
      withholdingTax = contributions.bir.tax;
      govtContributionsTotal = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
      
      // Store employer contributions for accounting (also respects cutoff)
      sssEmployer = contributions.appliedSSS.employer;
      philHealthEmployer = contributions.appliedPhilHealth.employer;
      pagIbigEmployer = contributions.appliedPagIbig.employer;
      
      console.log('[Government Contributions Calculated]', {
        cutoff,
        frequency,
        contractBasicSalary,
        earnedBasicSalary,
        totalEarnings,
        sss: { employee: sssContribution, employer: sssEmployer },
        philHealth: { employee: philHealthContribution, employer: philHealthEmployer },
        pagIbig: { employee: pagIbigContribution, employer: pagIbigEmployer },
        withholdingTax,
        govtContributionsTotal
      });
    } else {
      // Fallback: Try to fetch SSS from Airtable if calculator not available
      sssContribution = await fetchSSSEmployeeContribution(employeeId);
      govtContributionsTotal = sssContribution;
      console.warn('GovContributions module not loaded, using Airtable SSS only');
    }
    
    const totalDeductions = govtContributionsTotal + otherDeductions;
    const netPay = totalEarnings - totalDeductions;
    
    // Update summary - New format
    updateElement('breakdownRegPay', `₱${totalRegPay.toFixed(2)}`);
    updateElement('breakdownOTPay', `₱${totalOTPay.toFixed(2)}`);
    updateElement('breakdownAllowance', `₱${allowance.toFixed(2)}`);
    updateElement('breakdownDoublePay', `₱${doublePay.toFixed(2)}`);
    updateElement('breakdownPerfectAttendance', `₱${perfectAttendanceBonus.toFixed(2)}`);
    updateElement('breakdownLeaveConversion', `₱${leaveConversionBonus.toFixed(2)}`);
    updateElement('breakdownTotalEarnings', `₱${totalEarnings.toFixed(2)}`);
    
    // Update government contribution display elements
    updateElement('breakdownSSS', `₱${sssContribution.toFixed(2)}`);
    updateElement('breakdownPhilHealth', `₱${philHealthContribution.toFixed(2)}`);
    updateElement('breakdownPagIbig', `₱${pagIbigContribution.toFixed(2)}`);
    updateElement('breakdownWithholdingTax', `₱${withholdingTax.toFixed(2)}`);
    updateElement('breakdownGovtTotal', `₱${govtContributionsTotal.toFixed(2)}`);
    
    // Hide SSS/PhilHealth/Pag-IBIG rows for 1st cut (they are only deducted on 2nd cut)
    const sssRow = document.getElementById('breakdownSSSRow');
    const philHealthRow = document.getElementById('breakdownPhilHealthRow');
    const pagIbigRow = document.getElementById('breakdownPagIbigRow');
    const govtHeader = document.getElementById('breakdownGovtHeader');
    
    if (cutoff === '1st') {
      // Hide SSS/PhilHealth/Pag-IBIG rows for 1st cut
      if (sssRow) sssRow.style.display = 'none';
      if (philHealthRow) philHealthRow.style.display = 'none';
      if (pagIbigRow) pagIbigRow.style.display = 'none';
      // Remove margin from header since rows below are hidden
      if (govtHeader) govtHeader.style.marginBottom = '0';
    } else {
      // Show SSS/PhilHealth/Pag-IBIG rows for 2nd cut
      if (sssRow) sssRow.style.display = 'flex';
      if (philHealthRow) philHealthRow.style.display = 'flex';
      if (pagIbigRow) pagIbigRow.style.display = 'flex';
      // Restore margin
      if (govtHeader) govtHeader.style.marginBottom = '0.25rem';
    }
    
    updateElement('breakdownOtherDed', `₱${otherDeductions.toFixed(2)}`);
    updateElement('breakdownTotalDeductions', `₱${totalDeductions.toFixed(2)}`);
    updateElement('breakdownNetPay', `₱${netPay.toFixed(2)}`);
    updateElement('breakdownNetFormula', `₱${totalEarnings.toFixed(2)} - ₱${totalDeductions.toFixed(2)} = ₱${netPay.toFixed(2)}`);
    
    // Update Work Days for Time-based employees (count present days including halfday, undertime, overtime)
    if (!isFixedRate) {
      updateElement('breakdownWorkDays', totalDays);
    }
    
    // Store calculated data for saving
    currentBreakdownContext.calculatedData = {
      startDate,
      endDate,
      totalDays,
      totalRegHrs,
      totalOTHrs,
      totalLate,
      totalAbsent,
      totalRegPay,
      totalOTPay,
      allowance,
      doublePay,
      perfectAttendanceBonus,
      hasPerfectAttendance,
      leaveConversionBonus,
      totalPersonalLeaveUsed,
      lateDed,
      absentDed,
      totalEarnings,
      // Government contributions - employee share (deducted from pay)
      sssContribution,
      philHealthContribution,
      pagIbigContribution,
      withholdingTax,
      govtContributionsTotal,
      // Government contributions - employer share (for accounting)
      sssEmployer,
      philHealthEmployer,
      pagIbigEmployer,
      // Other deductions
      otherDeductions,
      totalDeductions,
      netPay,
      attendanceRecords
    };
    
    console.log(`Loaded ${attendanceRecords.length} attendance records`);
    
    // Reload salary advances now that period dates are determined
    // Advances are filtered by the selected cutoff period dates
    await loadSalaryAdvancesForBreakdown();
    
  } catch (error) {
    console.error('Error loading attendance:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:2rem; color:#dc3545;">
          Error loading attendance: ${error.message}
        </td>
      </tr>
    `;
    showNotification('Error loading attendance records', 'error');
  }
}

// Fetch attendance records from Airtable
async function fetchAttendanceForEmployee(employeeId, startDate, endDate) {
  const baseId = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
  const apiKey = AIRTABLE_CONFIG.API_KEY;
  
  // Build filter formula using DATETIME_FORMAT for consistent date comparison
  // Use FIND for string comparison to handle both string and numeric EmployeeId
  const filterFormula = encodeURIComponent(
    `AND(FIND('${employeeId}', {EmployeeId}&'')>0, DATETIME_FORMAT({Date}, 'YYYY-MM-DD')>='${startDate}', DATETIME_FORMAT({Date}, 'YYYY-MM-DD')<='${endDate}')`
  );
  
  console.log('[fetchAttendanceForEmployee] Query:', { employeeId, startDate, endDate });
  
  let allRecords = [];
  let offset = null;
  
  do {
    let url = `https://api.airtable.com/v0/${baseId}/${AIRTABLE_ATTENDANCE_TABLE}?filterByFormula=${filterFormula}&sort[0][field]=Date&sort[0][direction]=asc`;
    if (offset) {
      url += `&offset=${offset}`;
    }
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      cache: 'no-store' // Prevent browser caching to always fetch fresh data
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[fetchAttendanceForEmployee] Error response:', response.status, errorData);
      throw new Error('Failed to fetch attendance records');
    }
    
    const data = await response.json();
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  
  console.log('[fetchAttendanceForEmployee] Fetched records:', allRecords.length);
  return allRecords;
}

// Format time for display
function formatTimeDisplay(timeString) {
  if (!timeString) return '-';
  try {
    // Handle different time formats
    if (timeString.includes('AM') || timeString.includes('PM')) {
      return timeString;
    }
    // Parse as 24-hour time
    const [hours, minutes] = timeString.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch (e) {
    return timeString;
  }
}

// Format decimal hours to "Xh Ym" format (e.g., 10.33 -> "10h 20m")
function formatHoursMinutes(decimalHours) {
  if (!decimalHours || decimalHours === 0) return '0h 0m';
  
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  
  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
}

// Helper to update element text (supports HTML)
function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

// Save Breakdown Record to PayrollItems table
async function saveBreakdownRecord() {
  if (!currentBreakdownContext.calculatedData) {
    showNotification('Please load attendance data first', 'error');
    return;
  }
  
  // Check skip checkbox state and synchronize deduction amount
  const skipCheckbox = document.getElementById('skipAdvanceDeduction');
  if (skipCheckbox && skipCheckbox.checked) {
    // Ensure deduction is 0 when skip is checked
    currentAdvanceDeductionData.deductionAmount = 0;
    console.log('[SaveBreakdown] Skip checkbox is checked, setting deduction to 0');
  }
  
  // Check if there's an outstanding salary advance that's not being deducted
  const outstandingAdvance = currentAdvanceDeductionData.outstandingBalance || 0;
  const plannedDeduction = currentAdvanceDeductionData.deductionAmount || 0;
  
  console.log('[SaveBreakdown] outstandingAdvance:', outstandingAdvance, 'plannedDeduction:', plannedDeduction);
  
  if (outstandingAdvance > 0 && plannedDeduction === 0) {
    const proceed = await showConfirmModal(
      'Salary Advance Not Deducted',
      `${currentBreakdownContext.employeeName} has an outstanding salary advance of ₱${outstandingAdvance.toFixed(2)} that is NOT being deducted.\n\nAre you sure you want to save WITHOUT deducting the salary advance?\n\nClick Cancel to go back and include the deduction.`,
      'warning'
    );
    if (!proceed) return;
  }
  
  // Disable save button and show loading
  const saveBtn = document.querySelector('#dailyBreakdownModal button[onclick="window.saveBreakdownRecord()"]');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const data = currentBreakdownContext.calculatedData;
    const empData = currentBreakdownContext.employeeData;
    
    // Check if all deductions are excluded
    const excludeAllDeductions = data.excludeAllDeductions || false;
    
    // Use effective values (will be 0 if excluded)
    const sssContribution = excludeAllDeductions ? 0 : (data.sssContribution || 0);
    const philHealthContribution = excludeAllDeductions ? 0 : (data.philHealthContribution || 0);
    const pagIbigContribution = excludeAllDeductions ? 0 : (data.pagIbigContribution || 0);
    const withholdingTax = excludeAllDeductions ? 0 : (data.withholdingTax || 0);
    const govtContributionsTotal = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
    
    // Employer contributions for accounting (also 0 if excluded)
    const sssEmployer = excludeAllDeductions ? 0 : (data.sssEmployer || 0);
    const philHealthEmployer = excludeAllDeductions ? 0 : (data.philHealthEmployer || 0);
    const pagIbigEmployer = excludeAllDeductions ? 0 : (data.pagIbigEmployer || 0);
    
    console.log('[SaveBreakdown] excludeAllDeductions:', excludeAllDeductions);
    
    const grossPay = data.totalEarnings || 0;
    const advanceDeduction = currentAdvanceDeductionData.deductionAmount || 0;
    const otherDeductions = data.otherDeductions || 0;
    
    // Recalculate totalDeductions and netPay based on current advanceDeduction
    // This ensures skip checkbox state is respected
    const totalDeductions = govtContributionsTotal + advanceDeduction + otherDeductions + (data.lateDed || 0) + (data.absentDed || 0);
    const netPay = grossPay - totalDeductions;
    
    console.log('[SaveBreakdown] Calculated: grossPay=', grossPay, 'advanceDeduction=', advanceDeduction, 'totalDeductions=', totalDeductions, 'netPay=', netPay);
    
    const doublePay = data.doublePay || 0;
    const lateDed = data.lateDed || 0;
    const absentDed = data.absentDed || 0;
    
    // Build daily breakdown JSON for storage
    // Daily standard hours = Standard Workweek Hours / 7 days
    // Apply same lunch adjustment logic as loadBreakdownAttendance
    const coreWorkingHours = empData?.coreWorkingHours || '';
    const scheduleSpan = getScheduleSpanHours(coreWorkingHours);
    const dailyFromWeekly = empData?.standardWorkweekHours ? empData.standardWorkweekHours / 7 : (40 / 7);
    let dailyStdHoursForSave = dailyFromWeekly;
    const hasLunchAdjustment = scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8;
    if (hasLunchAdjustment) {
      dailyStdHoursForSave = dailyFromWeekly - 1; // Subtract 1 hour for lunch
    }
    const savedDailyRate = empData?.baseSalary ? empData.baseSalary / 30 : 0;
    const savedHourlyRate = dailyStdHoursForSave > 0 ? savedDailyRate / dailyStdHoursForSave : 0;
    const savedOvertimeRate = empData?.rateType === 'Fixed' ? 0 : savedHourlyRate * 1.25;
    
    const dailyBreakdownData = {
      employeeId: currentBreakdownContext.employeeId,
      employeeName: currentBreakdownContext.employeeName,
      startDate: data.startDate,
      endDate: data.endDate,
      rates: {
        dailyRate: savedDailyRate,
        hourlyRate: savedHourlyRate,
        overtimeRate: savedOvertimeRate,
        isFixedRate: empData?.rateType === 'Fixed',
        standardWorkweekHours: empData?.standardWorkweekHours || 40,
        coreWorkingHours: coreWorkingHours
      },
      dailyRecords: data.attendanceRecords ? data.attendanceRecords.map(r => {
        const fields = r.fields;
        const totalHoursWorked = parseFloat(fields.TotalHoursWorked || 0);
        const otHours = parseFloat(fields.OvertimeHours || 0);
        // Regular hours = Total hours worked - Overtime hours
        const regHours = Math.max(0, totalHoursWorked - otHours);
        const hasAM = !!(fields.TimeInAM && fields.TimeOutAM);
        const hasPM = !!(fields.TimeInPM && fields.TimeOutPM);
        
        // Calculate status (same as loadBreakdownAttendance)
        // Daily standard hours = Standard Workweek Hours / 7 days
        const isFixed = empData?.rateType === 'Fixed';
        const dailyStdHours = empData?.standardWorkweekHours ? empData.standardWorkweekHours / 7 : (40 / 7);
        const minHoursForHalfDay = dailyStdHours / 2 * 0.75;
        const minHoursForValid = 0.5;
        const tol = 0.01;
        
        let computedStatus;
        if (!hasAM && !hasPM) {
          computedStatus = 'Absent';
        } else if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
          if (totalHoursWorked < minHoursForValid) {
            computedStatus = 'Invalid';
          } else if (totalHoursWorked < minHoursForHalfDay) {
            computedStatus = 'Undertime';
          } else {
            computedStatus = 'Half Day';
          }
        } else {
          // Both AM and PM present
          if (isFixed) {
            // Fixed employees: always "Present" when both AM and PM are logged
            computedStatus = 'Present';
          } else {
            if (totalHoursWorked < (dailyStdHours - tol)) {
              computedStatus = 'Undertime';
            } else if (totalHoursWorked > (dailyStdHours + tol)) {
              computedStatus = 'Overtime';
            } else {
              computedStatus = 'Present';
            }
          }
        }
        
        return {
          date: fields.Date,
          dayName: new Date(fields.Date).toLocaleDateString('en-US', { weekday: 'short' }),
          regularHours: regHours,
          overtimeHours: parseFloat(fields.OvertimeHours || 0),
          timeInAM: fields.TimeIn || fields.TimeInAM || null,
          timeOutAM: fields.TimeOutAM || null,
          timeInPM: fields.TimeInPM || null,
          timeOutPM: fields.TimeOut || fields.TimeOutPM || null,
          isDoublePay: fields.IsDoublePay || false,
          status: computedStatus,
          lateMinutes: parseFloat(fields.LateMinutes || 0),
          remarks: fields.Remarks || null
        };
      }) : [], // Include all records including Invalid (for display purposes)
      totals: {
        totalDays: data.totalDays,
        totalRegularHours: data.totalRegHrs,
        totalOvertimeHours: data.totalOTHrs,
        totalRegularPay: data.totalRegPay,
        totalOvertimePay: data.totalOTPay,
        allowance: data.allowance || 0,
        doublePay: doublePay,
        perfectAttendanceBonus: data.perfectAttendanceBonus || 0,
        hasPerfectAttendance: data.hasPerfectAttendance || false,
        leaveConversionBonus: data.leaveConversionBonus || 0,
        totalLateMinutes: data.totalLate,
        totalAbsentDays: data.totalAbsent,
        lateDeductions: lateDed,
        absentDeductions: absentDed,
        // Government contributions - employee share
        sssContribution: sssContribution,
        philHealthContribution: philHealthContribution,
        pagIbigContribution: pagIbigContribution,
        withholdingTax: withholdingTax,
        govtContributionsTotal: govtContributionsTotal,
        // Government contributions - employer share (for accounting)
        sssEmployer: sssEmployer,
        philHealthEmployer: philHealthEmployer,
        pagIbigEmployer: pagIbigEmployer,
        // Other deductions
        advanceDeduction: advanceDeduction,
        totalDeductions: totalDeductions,
        grossPay: grossPay,
        netPay: netPay
      },
      createdAt: new Date().toISOString()
    };
    
    // Prepare payload for PayrollItems table (field names match Airtable schema)
    const payrollItemData = {
      // Core identifiers
      payrollId: currentBreakdownContext.payrollId || '',
      employeeId: currentBreakdownContext.employeeId,
      
      // Salary & Hours Fields
      basicSalary: empData?.baseSalary || 0,
      regularHours: data.totalRegHrs,
      overtimeHours: data.totalOTHrs,
      overtimePay: data.totalOTPay,
      allowances: data.allowance || empData?.allowance || 0,
      bonuses: doublePay, // Double pay saved as bonuses
      
      // Pay Calculation Fields
      grossPay: grossPay,
      netPay: netPay,
      
      // Government Contribution Fields - Employee Share
      sssContribution: sssContribution,
      philHealthContribution: philHealthContribution,
      pagIbigContribution: pagIbigContribution,
      withholdingTax: withholdingTax,
      
      // Government Contribution Fields - Employer Share (for accounting)
      sssEmployer: sssEmployer,
      philHealthEmployer: philHealthEmployer,
      pagIbigEmployer: pagIbigEmployer,
      
      // Deduction Fields
      lateDeductions: lateDed,
      absentDeductions: absentDed, // Maps to AbsenceDeductions in Airtable
      salaryAdvanceDeduction: advanceDeduction, // Salary advance repayment
      otherDeductions: 0,
      totalDeductions: totalDeductions,
      
      // Status & Documentation
      status: 'Pending',
      remarks: `Daily breakdown for ${data.startDate} to ${data.endDate}`,
      
      // Date Fields
      startDate: data.startDate,
      endDate: data.endDate,
      
      // Breakdown & Analysis Fields
      dailyBreakdownJSON: JSON.stringify(dailyBreakdownData),
      totalRegularHours: data.totalRegHrs,
      totalOvertimeHours: data.totalOTHrs,
      isDailyBreakdown: true,
      breakdownPeriod: `${data.startDate} to ${data.endDate}`
    };
    
    console.log('Saving payroll item to Airtable:', payrollItemData);
    
    // Check if createPayrollItemRecord function exists
    if (!window.createPayrollItemRecord) {
      throw new Error('createPayrollItemRecord function not found. Make sure compensation-api.js is loaded.');
    }
    
    // Save to PayrollItems table (audit logging is handled in compensation-api.js)
    const savedRecord = await window.createPayrollItemRecord(payrollItemData);
    
    console.log('Payroll item saved successfully:', savedRecord);
    
    // Log salary advance deduction (NO separate repayment transaction needed)
    // The advance was already recorded as Cash Out in Finance when given
    // Deducting from payroll just reduces what employee receives - that's the repayment
    if (advanceDeduction > 0) {
      console.log('[Payroll] Salary advance deduction applied:', {
        employee: currentBreakdownContext.employeeName,
        deductionAmount: advanceDeduction,
        outstandingBefore: currentAdvanceDeductionData.outstandingBalance,
        remainingAfter: currentAdvanceDeductionData.outstandingBalance - advanceDeduction,
        payrollPeriod: `${data.startDate} to ${data.endDate}`
      });
    }
    
    // NOTE: Journal entries are now created by Finance via the "Accrued Payroll" tab
    // in Financial Statement module. This gives Finance control over when salary
    // expense entries are posted, rather than auto-creating on each payroll save.
    // The payroll data is saved to PayrollItems table and can be loaded by Finance
    // when they're ready to create the accrued salary expense journal entries.
    console.log('[Payroll] Journal entries will be created by Finance via Accrued Payroll tab');
    
    showNotification('Breakdown saved successfully!', 'success');
    
    // Refresh breakdown history for the current employee
    const empIdEl = document.getElementById('viewCompEmpId');
    if (empIdEl?.value) {
      await loadBreakdownHistory(empIdEl.value);
    }
    
    // Close modal after a delay
    setTimeout(() => {
      closeDailyBreakdownModal();
      // Optionally refresh the compensations list
      if (typeof loadCompensations === 'function') {
        loadCompensations();
      }
    }, 1500);
    
  } catch (error) {
    console.error('Error saving breakdown:', error);
    showNotification('Error saving breakdown: ' + error.message, 'error');
  } finally {
    // Re-enable save button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Breakdown';
    }
  }
}

// Get latest SSS contribution for an employee from SSSContributionRecords
async function getLatestSSSContribution(employeeId) {
  const baseId = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
  const apiKey = AIRTABLE_CONFIG.API_KEY;
  const table = AIRTABLE_CONFIG.TABLES.SSS_CONTRIBUTION_RECORDS;
  
  const filterFormula = encodeURIComponent(`{EmployeeId}='${employeeId}'`);
  const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${filterFormula}&sort[0][field]=ApplicableMonth&sort[0][direction]=desc&maxRecords=1`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    console.warn('Failed to fetch SSS contribution');
    return 0;
  }
  
  const data = await response.json();
  if (data.records && data.records.length > 0) {
    const latestRecord = data.records[0];
    return parseFloat(latestRecord.fields.EmployeeContribution || 0);
  }
  
  return 0;
}

// Show View Breakdown Modal
function showViewBreakdownModal(breakdownData) {
  const modal = document.getElementById('viewBreakdownModal');
  if (!modal) return;
  
  if (breakdownData && typeof breakdownData === 'object') {
    currentViewBreakdownData = breakdownData;
    populateViewBreakdownModal(breakdownData);
  }
  
  modal.style.display = 'block';
}

// Populate View Breakdown Modal with data
function populateViewBreakdownModal(data) {
  console.log('Populating view breakdown modal with:', data);
  
  // Set employee info
  updateElement('viewBreakdownEmpName', data.employeeName || 'Unknown');
  updateElement('viewBreakdownEmpId', data.employeeId || 'N/A');
  updateElement('viewBreakdownEmpDept', data.department || '');
  updateElement('viewBreakdownPeriod', `${formatDateDisplay(data.startDate)} - ${formatDateDisplay(data.endDate)}`);
  
  // Set initials
  const initials = document.getElementById('viewBreakdownEmpInitials');
  if (initials && data.employeeName) {
    const parts = data.employeeName.split(' ');
    initials.textContent = parts.length >= 2 
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : data.employeeName.substring(0, 2).toUpperCase();
  }
  
  // Set rate info
  const rates = data.rates || {};
  const isFixedRate = rates.isFixedRate || false;
  updateElement('viewBreakdownDailyRate', `₱${(rates.dailyRate || 0).toFixed(2)}`);
  updateElement('viewBreakdownHourlyRate', `₱${(rates.hourlyRate || 0).toFixed(2)}`);
  updateElement('viewBreakdownOTRate', isFixedRate ? 'N/A' : `₱${(rates.overtimeRate || 0).toFixed(2)}`);
  
  // Work Days calculation:
  // Fixed: ALL calendar days in the period (including Sat/Sun)
  // Time-based: Count of present days (stored in totals.totalDays from attendance)
  let workDaysDisplay;
  if (isFixedRate && data.startDate && data.endDate) {
    workDaysDisplay = calculateAllDaysInPeriod(data.startDate, data.endDate);
  } else {
    workDaysDisplay = data.totals?.totalDays || 0;
  }
  updateElement('viewBreakdownWorkDays', workDaysDisplay);
  updateElement('viewBreakdownEmpType', data.rateType || (isFixedRate ? 'Fixed' : 'Time-based'));
  
  // Populate attendance records table
  populateViewBreakdownAttendanceTable(data.dailyRecords || [], rates);
  
  // Update summaries from totals - New format
  const totals = data.totals || {};
  const regularPay = totals.totalRegularPay || 0;
  const overtimePay = totals.totalOvertimePay || 0;
  const allowance = totals.allowance || 0;
  const doublePay = totals.doublePay || 0;
  const perfectAttendanceBonus = totals.perfectAttendanceBonus || 0;
  const leaveConversionBonus = totals.leaveConversionBonus || 0;
  const hasPerfectAttendance = totals.hasPerfectAttendance || false;
  const totalEarnings = regularPay + overtimePay + allowance + doublePay + perfectAttendanceBonus + leaveConversionBonus;
  
  // Government contributions
  const sssContribution = totals.sssContribution || 0;
  const philHealthContribution = totals.philHealthContribution || 0;
  const pagIbigContribution = totals.pagIbigContribution || 0;
  const withholdingTax = totals.withholdingTax || 0;
  const govtContributionsTotal = sssContribution + philHealthContribution + pagIbigContribution + withholdingTax;
  
  // Other deductions
  const otherDeductions = totals.otherDeductions || 0;
  const advanceDeduction = totals.advanceDeduction || 0;
  
  const totalDeductions = govtContributionsTotal + otherDeductions + advanceDeduction;
  const netPay = totalEarnings - totalDeductions;
  
  updateElement('viewBreakdownRegPay', `₱${regularPay.toFixed(2)}`);
  updateElement('viewBreakdownOTPay', `₱${overtimePay.toFixed(2)}`);
  updateElement('viewBreakdownAllowance', `₱${allowance.toFixed(2)}`);
  updateElement('viewBreakdownDoublePay', `₱${doublePay.toFixed(2)}`);
  updateElement('viewBreakdownPerfectAttendance', `₱${perfectAttendanceBonus.toFixed(2)}`);
  updateElement('viewBreakdownLeaveConversion', `₱${leaveConversionBonus.toFixed(2)}`);
  updateElement('viewBreakdownTotalEarnings', `₱${totalEarnings.toFixed(2)}`);
  
  // Government contributions
  updateElement('viewBreakdownSSS', `₱${sssContribution.toFixed(2)}`);
  updateElement('viewBreakdownPhilHealth', `₱${philHealthContribution.toFixed(2)}`);
  updateElement('viewBreakdownPagIbig', `₱${pagIbigContribution.toFixed(2)}`);
  updateElement('viewBreakdownWithholdingTax', `₱${withholdingTax.toFixed(2)}`);
  updateElement('viewBreakdownGovtTotal', `₱${govtContributionsTotal.toFixed(2)}`);
  
  // Hide SSS/PhilHealth/Pag-IBIG rows for 1st cut (they are only deducted on 2nd cut)
  // Determine if this is 1st cut based on the end date
  const endDate = new Date(data.endDate);
  const is1stCut = endDate.getDate() <= 15;
  
  const sssRow = document.getElementById('viewBreakdownSSSRow');
  const philHealthRow = document.getElementById('viewBreakdownPhilHealthRow');
  const pagIbigRow = document.getElementById('viewBreakdownPagIbigRow');
  const govtHeader = document.getElementById('viewBreakdownGovtHeader');
  
  if (is1stCut) {
    // Hide SSS/PhilHealth/Pag-IBIG rows for 1st cut
    if (sssRow) sssRow.style.display = 'none';
    if (philHealthRow) philHealthRow.style.display = 'none';
    if (pagIbigRow) pagIbigRow.style.display = 'none';
    // Remove margin from header since rows below are hidden
    if (govtHeader) govtHeader.style.marginBottom = '0';
  } else {
    // Show SSS/PhilHealth/Pag-IBIG rows for 2nd cut
    if (sssRow) sssRow.style.display = 'flex';
    if (philHealthRow) philHealthRow.style.display = 'flex';
    if (pagIbigRow) pagIbigRow.style.display = 'flex';
    // Restore margin
    if (govtHeader) govtHeader.style.marginBottom = '0.25rem';
  }
  
  // Other deductions
  updateElement('viewBreakdownOtherDed', `₱${otherDeductions.toFixed(2)}`);
  updateElement('viewBreakdownAdvanceDeduction', `₱${advanceDeduction.toFixed(2)}`);
  updateElement('viewBreakdownTotalDeductions', `₱${totalDeductions.toFixed(2)}`);
  updateElement('viewBreakdownNetPay', `₱${netPay.toFixed(2)}`);
  updateElement('viewBreakdownNetFormula', `₱${totalEarnings.toFixed(2)} - ₱${totalDeductions.toFixed(2)} = ₱${netPay.toFixed(2)}`);
}

// Populate attendance table in View Breakdown modal
function populateViewBreakdownAttendanceTable(dailyRecords, rates) {
  const tbody = document.getElementById('viewBreakdownAttendanceBody');
  if (!tbody) return;
  
  if (!dailyRecords || dailyRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:2rem; color:#888;">
          No attendance records available
        </td>
      </tr>
    `;
    return;
  }
  
  const overtimeRate = rates?.overtimeRate || 0;
  const dailyRate = rates?.dailyRate || 0;
  const hourlyRate = rates?.hourlyRate || 0;
  const isFixedRate = rates?.isFixedRate || false;
  const standardWorkweekHours = rates?.standardWorkweekHours || 40;
  const coreWorkingHours = rates?.coreWorkingHours || '';
  
  // Calculate daily standard hours with lunch adjustment (same as loadBreakdownAttendance)
  const scheduleSpan = getScheduleSpanHours(coreWorkingHours);
  const dailyFromWeekly = standardWorkweekHours / 7;
  let dailyStandardHours = dailyFromWeekly;
  const hasLunchAdjustment = scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8;
  if (hasLunchAdjustment) {
    dailyStandardHours = dailyFromWeekly - 1; // Subtract 1 hour for lunch
  }
  
  const rows = dailyRecords.map(record => {
    const date = new Date(record.date);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    // Format Time In (AM and PM)
    const timeInAM = formatTimeDisplay(record.timeInAM);
    const timeInPM = formatTimeDisplay(record.timeInPM);
    const timeInDisplay = timeInAM !== '-' || timeInPM !== '-' 
      ? `${timeInAM !== '-' ? timeInAM : '-'}<br>${timeInPM !== '-' ? timeInPM : '-'}`
      : '-';
    
    // Format Time Out (AM and PM)
    const timeOutAM = formatTimeDisplay(record.timeOutAM);
    const timeOutPM = formatTimeDisplay(record.timeOutPM);
    const timeOutDisplay = timeOutAM !== '-' || timeOutPM !== '-'
      ? `${timeOutAM !== '-' ? timeOutAM : '-'}<br>${timeOutPM !== '-' ? timeOutPM : '-'}`
      : '-';
    
    const regHours = record.regularHours || 0;
    const otHours = record.overtimeHours || 0;
    const isDoublePay = record.isDoublePay || false;
    const dayDoublePay = isDoublePay ? dailyRate : 0;
    
    // Compute status based on AM/PM time pattern (same logic as attendance.js getStatus)
    const hasAM = !!(record.timeInAM && record.timeOutAM);
    const hasPM = !!(record.timeInPM && record.timeOutPM);
    const isAbsent = !hasAM && !hasPM;
    const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM);
    
    // Minimum hours thresholds (same as attendance.js)
    const minHoursForHalfDay = dailyStandardHours / 2 * 0.75; // At least 75% of half day
    const minHoursForValid = 0.5; // At least 30 minutes to count as valid work
    const tol = 0.01;
    
    // Calculate total hours worked for status check (regHours is already the computed value)
    const totalHoursWorked = regHours + otHours;
    
    // Calculate display hours (add lunch back for display if applicable)
    const displayTotalHours = hasLunchAdjustment && !isAbsent ? totalHoursWorked + 1 : totalHoursWorked;
    
    let status;
    if (isAbsent) {
      status = 'Absent';
    } else if (isHalfDay) {
      // Only AM or PM - check if enough hours for Half Day
      if (totalHoursWorked < minHoursForValid) {
        status = 'Invalid'; // Too short to count (e.g., 5 minutes)
      } else if (totalHoursWorked < minHoursForHalfDay) {
        status = 'Undertime'; // Some work but not enough for half day
      } else {
        status = 'Half Day';
      }
    } else {
      // Both AM and PM present - check total hours
      if (totalHoursWorked < 0) {
        status = 'Invalid';
      } else if (totalHoursWorked < (dailyStandardHours - tol)) {
        status = 'Undertime';
      } else if (totalHoursWorked > (dailyStandardHours + tol)) {
        status = 'Overtime';
      } else {
        status = 'Present';
      }
    }
    
    // Calculate Regular Pay based on rate type
    // For Fixed employees: full daily rate, half for half day, 0 for absent/invalid
    // For Time-based employees: regular hours × hourly rate
    let regPay;
    if (isFixedRate) {
      if (status === 'Absent' || status === 'Invalid') {
        regPay = 0;
      } else if (status === 'Half Day') {
        regPay = dailyRate / 2;
      } else {
        regPay = dailyRate; // Full daily rate regardless of hours worked
      }
    } else {
      regPay = regHours * hourlyRate;
    }
    const otPay = isFixedRate ? 0 : otHours * overtimeRate;
    
    // Status color (same as attendance.js)
    let statusColor = '#16a34a'; // green for present
    if (status === 'Overtime') statusColor = '#2563eb';
    if (status === 'Undertime') statusColor = '#ea580c';
    if (status === 'Half Day') statusColor = '#ca8a04';
    if (status === 'Absent') statusColor = '#dc2626';
    if (status === 'Late') statusColor = '#ffc107';
    if (status === 'Leave') statusColor = '#0dcaf0';
    if (status === 'Invalid') statusColor = '#9333ea'; // Purple for invalid/too short
    
    // For Invalid records, show grayed out (not calculated) but still readable
    const isInvalid = status === 'Invalid';
    const rowStyle = isInvalid 
      ? 'opacity:0.6;' 
      : '';
    const payDisplay = isInvalid ? '₱0.00' : `₱${regPay.toFixed(2)}`;
    const otPayDisplay = isInvalid ? '₱0.00' : `₱${otPay.toFixed(2)}`;
    
    return `
      <tr style="${rowStyle}">
        <td style="padding:0.5rem; color:#fff; border:1px solid #275b48;">${dateStr}</td>
        <td style="padding:0.5rem; text-align:center; color:#fff; border:1px solid #275b48;">${timeInDisplay}</td>
        <td style="padding:0.5rem; text-align:center; color:#fff; border:1px solid #275b48;">${timeOutDisplay}</td>
        <td style="padding:0.5rem; text-align:center; color:#fff; border:1px solid #275b48;">${formatHoursMinutes(displayTotalHours)}</td>
        <td style="padding:0.5rem; text-align:center; color:${isInvalid ? '#888' : '#28a745'}; font-weight:500; border:1px solid #275b48;">${payDisplay}</td>
        <td style="padding:0.5rem; text-align:center; color:#fff; border:1px solid #275b48;">${otHours > 0 ? formatHoursMinutes(otHours) : '-'}</td>
        <td style="padding:0.5rem; text-align:center; color:${isInvalid ? '#888' : '#28a745'}; border:1px solid #275b48;">${otHours > 0 ? otPayDisplay : '-'}</td>
        <td style="padding:0.5rem; text-align:center; color:${isDoublePay ? '#d97706' : '#888'}; border:1px solid #275b48;">${isDoublePay ? '₱' + dayDoublePay.toFixed(2) : '-'}</td>
        <td style="padding:0.5rem; text-align:center; border:1px solid #275b48;"><span style="color:${statusColor}; font-weight:500;">${status}${isInvalid ? ' ⚠️' : ''}</span></td>
      </tr>
    `;
  }).join('');
  
  tbody.innerHTML = rows;
}

// Format date for display
function formatDateDisplay(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateString;
  }
}

// Close View Breakdown Modal
function closeViewBreakdownModal() {
  const modal = document.getElementById('viewBreakdownModal');
  if (modal) modal.style.display = 'none';
  currentViewBreakdownData = null;
}

// Reset breakdown summary values
function resetBreakdownSummary() {
  const tbody = document.getElementById('breakdownAttendanceBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:2rem; color:#888;">
          Select a period and click "Load Attendance" to view records
        </td>
      </tr>
    `;
  }
  
  // Reset money fields - new format
  const moneyFields = [
    'breakdownRegPay', 'breakdownOTPay', 'breakdownAllowance', 
    'breakdownDoublePay', 'breakdownTotalEarnings',
    'breakdownSSS', 'breakdownOtherDed', 'breakdownTotalDeductions',
    'breakdownNetPay'
  ];
  moneyFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '₱0.00';
  });
  
  // Reset formula
  const formulaEl = document.getElementById('breakdownNetFormula');
  if (formulaEl) formulaEl.textContent = 'Earnings - Deductions = Net Pay';
}

// Refresh Compensation Directory
async function refreshCompensationDirectory() {
  showNotification('Refreshing compensation records...', 'info');
  await loadCompensations();
  showNotification('Compensation records refreshed!', 'success');
}

// Refresh Breakdown Modal (for viewing individual payroll breakdown)
async function refreshBreakdownModal() {
  const recordId = window._currentBreakdownRecordId;
  if (recordId && window.viewCompensation) {
    showNotification('Refreshing payroll breakdown...', 'info');
    await window.viewCompensation(recordId);
    showNotification('Payroll breakdown refreshed!', 'success');
  }
}

// Export functions to window for use in HTML
window.loadCompensations = loadCompensations;
window.renderCompensations = renderCompensations;
window.viewCompensation = viewCompensation;
window.deleteCompensation = deleteCompensation;
window.closeViewCompensationModal = closeViewCompensationModal;
window.applyCompensationFilters = applyCompensationFilters;
window.clearCompensationFilters = clearCompensationFilters;
window.showAddCompensationModal = showAddCompensationModal;
window.closeAddCompensationModal = closeAddCompensationModal;
window.updateCompEmployeeInfo = updateCompEmployeeInfo;
window.calculateCompTotals = calculateCompTotals;
window.saveCompensationRecord = saveCompensationRecord;
window.showDailyBreakdownModal = showDailyBreakdownModal;
window.closeDailyBreakdownModal = closeDailyBreakdownModal;
window.refreshCompensationDirectory = refreshCompensationDirectory;
window.refreshBreakdownModal = refreshBreakdownModal;
window.loadBreakdownAttendance = loadBreakdownAttendance;
window.saveBreakdownRecord = saveBreakdownRecord;
window.showViewBreakdownModal = showViewBreakdownModal;
window.closeViewBreakdownModal = closeViewBreakdownModal;
window.loadBreakdownHistory = loadBreakdownHistory;
window.viewBreakdownDetails = viewBreakdownDetails;
window.showDeleteBreakdownModal = showDeleteBreakdownModal;
window.closeDeleteBreakdownModal = closeDeleteBreakdownModal;
window.confirmDeleteBreakdown = confirmDeleteBreakdown;
window.printPayrollBreakdown = printPayrollBreakdown;
window.printSalaryAdvances = printSalaryAdvances;
window.toggleAdvanceDeduction = toggleAdvanceDeduction;
window.updateAdvanceDeduction = updateAdvanceDeduction;

// ===== PRINT SALARY ADVANCES FUNCTION =====

// Print the salary advances summary for the current period
function printSalaryAdvances() {
  const advanceData = currentAdvanceDeductionData;
  
  if (!advanceData || !advanceData.advanceTransactions || advanceData.advanceTransactions.length === 0) {
    showNotification('No salary advances to print', 'error');
    return;
  }
  
  // Get employee info from DOM (same as printPayrollBreakdown)
  const employeeName = document.getElementById('viewBreakdownEmpName')?.textContent || advanceData.employeeName || 'Employee';
  const employeeId = document.getElementById('viewBreakdownEmpId')?.textContent || '';
  const employeeDept = document.getElementById('viewBreakdownEmpDept')?.textContent || '';
  const periodStart = advanceData.periodStart ? new Date(advanceData.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const periodEnd = advanceData.periodEnd ? new Date(advanceData.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  
  // Build table rows
  const tableRows = advanceData.advanceTransactions.map((adv, index) => {
    const dateObj = new Date(adv.date);
    const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <tr>
        <td style="padding:4px 6px; border:1px solid #333; text-align:center; background:${index % 2 === 0 ? '#fff' : '#f9f9f9'};">${index + 1}</td>
        <td style="padding:4px 6px; border:1px solid #333; background:${index % 2 === 0 ? '#fff' : '#f9f9f9'};">${dateStr}</td>
        <td style="padding:4px 6px; border:1px solid #333; text-align:right; color:#990000; background:${index % 2 === 0 ? '#fff' : '#f9f9f9'};">₱${adv.amount.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
      </tr>
    `;
  }).join('');
  
  // Create print content matching the payroll breakdown theme
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Salary Advances - ${employeeName}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 8mm 8mm 8mm 8mm;
        }
        body {
          font-family: Arial, sans-serif;
          padding: 0;
          margin: 0;
          color: #000;
          background: #fff;
        }
        .header {
          text-align: center;
          border-bottom: 1px solid #000;
          margin-bottom: 8px;
          padding-bottom: 4px;
        }
        .header h1 {
          margin: 0;
          font-size: 14pt;
          color: #000;
        }
        .header h2 {
          margin: 4px 0 2px;
          font-size: 12pt;
          color: #333;
          font-weight: normal;
        }
        .header p {
          margin: 2px 0;
          font-size: 10pt;
          color: #333;
        }
        .employee-header {
          display: flex;
          flex-wrap: wrap;
          background: #f5f5f5;
          border: 1px solid #333;
          padding: 6px 10px;
          margin-bottom: 8px;
          gap: 15px;
        }
        .employee-info {
          flex: 1;
        }
        .employee-name {
          font-size: 12pt;
          font-weight: bold;
          color: #000;
        }
        .employee-detail {
          font-size: 10pt;
          color: #333;
        }
        .summary-box {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
        }
        .summary-item {
          background: #f0f0f0;
          border: 1px solid #999;
          padding: 4px 10px;
          text-align: center;
        }
        .summary-label {
          font-size: 8pt;
          color: #555;
          text-transform: uppercase;
        }
        .summary-value {
          font-size: 11pt;
          font-weight: bold;
          color: #990000;
        }
        h4 {
          margin: 0 0 4px;
          font-size: 11pt;
          color: #000;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 8px;
        }
        th {
          background: #e0e0e0;
          color: #000;
          font-weight: bold;
          padding: 4px 6px;
          border: 1px solid #333;
          font-size: 10pt;
          text-align: center;
        }
        td {
          font-size: 10pt;
        }
        .total-row {
          background: #e8e8e8;
          font-weight: bold;
        }
        .total-row td {
          padding: 6px;
          border: 1px solid #333;
        }
        .signature-section {
          position: fixed;
          bottom: 10mm;
          left: 8mm;
          right: 8mm;
          background: #fff;
        }
        .date-received {
          display: flex;
          justify-content: center;
          margin-bottom: 8px;
        }
        .date-received-box {
          text-align: center;
          width: 30%;
        }
        .date-received-line {
          border-bottom: 1px solid #000;
          height: 20px;
          margin-bottom: 2px;
        }
        .signature-grid {
          display: flex;
          justify-content: space-between;
        }
        .signature-block {
          text-align: center;
          width: 23%;
        }
        .signature-line {
          border-bottom: 1px solid #000;
          height: 40px;
          margin-bottom: 2px;
        }
        .signature-label {
          font-size: 9pt;
          font-weight: bold;
          color: #000;
          margin-bottom: 1px;
        }
        .signature-name {
          font-size: 8pt;
          color: #000;
          margin-bottom: 0;
        }
        .signature-detail {
          font-size: 7pt;
          color: #555;
        }
        @media print {
          body { padding: 0; margin: 0; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>MORPH SAGRADO VENTURES INC.</h1>
        <h2>Salary Advances Summary</h2>
        <p>Period: ${periodStart} - ${periodEnd}</p>
      </div>
      
      <div class="employee-header">
        <div class="employee-info">
          <div class="employee-name">${employeeName}</div>
          <div class="employee-detail">${employeeId}</div>
          <div class="employee-detail">${employeeDept}</div>
        </div>
        <div class="summary-box">
          <div class="summary-item">
            <div class="summary-label">Total Advances</div>
            <div class="summary-value">₱${advanceData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
          </div>
        </div>
      </div>
      
      <h4>📋 Advance Records</h4>
      <table>
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th>Date</th>
            <th style="width:120px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr class="total-row">
            <td colspan="2" style="text-align:right; padding-right:10px;">TOTAL:</td>
            <td style="text-align:right; color:#990000;">₱${advanceData.outstandingBalance.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
          </tr>
        </tbody>
      </table>
      
      <div class="signature-section">
        <!-- Date Received -->
        <div class="date-received">
          <div class="date-received-box">
            <div class="date-received-line"></div>
            <div class="signature-label">Date Received</div>
          </div>
        </div>
        <!-- Signatories -->
        <div class="signature-grid">
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">PREPARED BY:</div>
            <div class="signature-name">Veloso, Lovely Ann N.</div>
            <div class="signature-detail">EMP-60322</div>
            <div class="signature-detail">Administrative Department</div>
          </div>
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">CHECKED BY:</div>
            <div class="signature-name">Nimia Faildon</div>
            <div class="signature-detail">MIFU Deployed Officer</div>
            <div class="signature-detail">Finance Department</div>
          </div>
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">APPROVED BY:</div>
            <div class="signature-name">Celine B. Martinez</div>
            <div class="signature-detail">Director of MIFU</div>
            <div class="signature-detail">Finance Department</div>
          </div>
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">RECEIVED BY:</div>
            <div class="signature-name">${employeeName}</div>
            <div class="signature-detail">${employeeId}</div>
            <div class="signature-detail">${employeeDept}</div>
          </div>
        </div>
      </div>
      
      <script>
        window.onload = function() {
          window.print();
          window.onafterprint = function() {
            window.close();
          };
        };
      </script>
    </body>
    </html>
  `;
  
  // Open print window
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
  } else {
    showNotification('Please allow popups to print', 'error');
  }
}

// ===== PRINT PAYROLL BREAKDOWN FUNCTION =====

// Print the payroll breakdown details with cut type filter
function printPayrollBreakdown(cutType = 'whole') {
  // Completely remove attendance print styles from DOM to prevent any conflicts
  const attendancePrintStyles = document.getElementById('attendancePrintStyles');
  let attendancePrintStylesParent = null;
  let attendancePrintStylesNextSibling = null;
  if (attendancePrintStyles) {
    attendancePrintStylesParent = attendancePrintStyles.parentNode;
    attendancePrintStylesNextSibling = attendancePrintStyles.nextSibling;
    attendancePrintStyles.remove();
  }
  
  // Clear any leftover print classes from previous print attempts
  document.body.classList.remove('printing-attendance');
  document.body.classList.remove('printing-payroll');
  
  // Add printing class to body to activate conditional print styles
  document.body.classList.add('printing-payroll');
  
  // Hide the employee initials circle (blue circle) during printing
  const empInitialsEl = document.getElementById('viewBreakdownEmpInitials');
  let originalInitialsDisplay = '';
  if (empInitialsEl) {
    originalInitialsDisplay = empInitialsEl.style.display;
    empInitialsEl.style.display = 'none';
  }
  
  // Get current breakdown data
  const employeeName = document.getElementById('viewBreakdownEmpName')?.textContent || 'Employee';
  const employeeDept = document.getElementById('viewBreakdownEmpDept')?.textContent || '';
  const employeeId = document.getElementById('viewBreakdownEmpId')?.textContent || '';
  const period = document.getElementById('viewBreakdownPeriod')?.textContent || '';
  
  // Populate signature section with employee info
  const printEmployeeNameEl = document.getElementById('printEmployeeName');
  const printEmployeePositionEl = document.getElementById('printEmployeePosition');
  const printEmployeeIdEl = document.getElementById('printEmployeeId');
  if (printEmployeeNameEl) printEmployeeNameEl.textContent = employeeName;
  if (printEmployeePositionEl) printEmployeePositionEl.textContent = employeeDept;
  if (printEmployeeIdEl) printEmployeeIdEl.textContent = employeeId;
  
  // Get the attendance table body
  const tbody = document.getElementById('viewBreakdownAttendanceBody');
  if (!tbody) {
    window.print();
    setTimeout(() => {
      // Re-add attendance print styles
      if (attendancePrintStyles && attendancePrintStylesParent) {
        if (attendancePrintStylesNextSibling) {
          attendancePrintStylesParent.insertBefore(attendancePrintStyles, attendancePrintStylesNextSibling);
        } else {
          attendancePrintStylesParent.appendChild(attendancePrintStyles);
        }
      }
      document.body.classList.remove('printing-payroll');
      // Restore employee initials circle visibility
      if (empInitialsEl) {
        empInitialsEl.style.display = originalInitialsDisplay || 'flex';
      }
    }, 1000);
    return;
  }
  
  // Store original rows
  const allRows = Array.from(tbody.querySelectorAll('tr'));
  const originalDisplay = allRows.map(row => row.style.display);
  
  // Filter rows based on cut type
  let cutLabel = 'Whole Month';
  allRows.forEach(row => {
    const dateCell = row.querySelector('td:first-child');
    if (!dateCell) return;
    
    const dateText = dateCell.textContent.trim();
    // Parse date (expecting format like "2025-12-01" or "Dec 1, 2025")
    let day = 0;
    
    // Try to parse YYYY-MM-DD format
    const isoMatch = dateText.match(/\d{4}-\d{2}-(\d{2})/);
    if (isoMatch) {
      day = parseInt(isoMatch[1], 10);
    } else {
      // Try to parse other formats like "Dec 1, 2025" or "1"
      const dayMatch = dateText.match(/(\d{1,2})/);
      if (dayMatch) {
        day = parseInt(dayMatch[1], 10);
      }
    }
    
    let shouldShow = true;
    if (cutType === '1st') {
      // 1st cut: days 1-15
      shouldShow = day >= 1 && day <= 15;
      cutLabel = '1st Cut (1-15)';
    } else if (cutType === '2nd') {
      // 2nd cut: days 16-31
      shouldShow = day >= 16 && day <= 31;
      cutLabel = '2nd Cut (16-30/31)';
    }
    // 'whole' shows all
    
    row.style.display = shouldShow ? '' : 'none';
  });
  
  // Store original title
  const originalTitle = document.title;
  
  // For 1st cut, hide Perfect Attendance and Leave Conversion (only paid on 2nd cut)
  const perfectAttendanceEl = document.getElementById('viewBreakdownPerfectAttendance');
  const leaveConversionEl = document.getElementById('viewBreakdownLeaveConversion');
  const perfectAttendanceRow = perfectAttendanceEl?.closest('div[style*="display:flex"]');
  const leaveConversionRow = leaveConversionEl?.closest('div[style*="display:flex"]');
  
  let originalPerfectAttendance = '';
  let originalLeaveConversion = '';
  
  if (cutType === '1st') {
    // Store original values and set to ₱0.00 for 1st cut
    if (perfectAttendanceEl) {
      originalPerfectAttendance = perfectAttendanceEl.textContent;
      perfectAttendanceEl.textContent = '₱0.00';
    }
    if (leaveConversionEl) {
      originalLeaveConversion = leaveConversionEl.textContent;
      leaveConversionEl.textContent = '₱0.00';
    }
    
    // Recalculate total earnings for display (subtract perfect attendance and leave conversion)
    const totalEarningsEl = document.getElementById('viewBreakdownTotalEarnings');
    const netPayEl = document.getElementById('viewBreakdownNetPay');
    if (totalEarningsEl && originalPerfectAttendance && originalLeaveConversion) {
      const currentTotal = parseFloat(totalEarningsEl.textContent.replace(/[₱,]/g, '')) || 0;
      const perfectAmt = parseFloat(originalPerfectAttendance.replace(/[₱,]/g, '')) || 0;
      const leaveAmt = parseFloat(originalLeaveConversion.replace(/[₱,]/g, '')) || 0;
      const adjustedTotal = currentTotal - perfectAmt - leaveAmt;
      totalEarningsEl.dataset.originalValue = totalEarningsEl.textContent;
      totalEarningsEl.textContent = `₱${adjustedTotal.toFixed(2)}`;
      
      // Also adjust net pay
      if (netPayEl) {
        const currentNet = parseFloat(netPayEl.textContent.replace(/[₱,]/g, '')) || 0;
        const adjustedNet = currentNet - perfectAmt - leaveAmt;
        netPayEl.dataset.originalValue = netPayEl.textContent;
        netPayEl.textContent = `₱${adjustedNet.toFixed(2)}`;
      }
    }
  }
  
  // Set print-friendly title (empty to hide browser header text)
  document.title = ' ';
  
  // Trigger print
  window.print();
  
  // Restore original title and row visibility after print dialog closes
  setTimeout(() => {
    document.title = originalTitle;
    allRows.forEach((row, index) => {
      row.style.display = originalDisplay[index];
    });
    
    // Restore Perfect Attendance and Leave Conversion values
    if (cutType === '1st') {
      if (perfectAttendanceEl && originalPerfectAttendance) {
        perfectAttendanceEl.textContent = originalPerfectAttendance;
      }
      if (leaveConversionEl && originalLeaveConversion) {
        leaveConversionEl.textContent = originalLeaveConversion;
      }
      
      // Restore total earnings and net pay
      const totalEarningsEl = document.getElementById('viewBreakdownTotalEarnings');
      const netPayEl = document.getElementById('viewBreakdownNetPay');
      if (totalEarningsEl?.dataset.originalValue) {
        totalEarningsEl.textContent = totalEarningsEl.dataset.originalValue;
        delete totalEarningsEl.dataset.originalValue;
      }
      if (netPayEl?.dataset.originalValue) {
        netPayEl.textContent = netPayEl.dataset.originalValue;
        delete netPayEl.dataset.originalValue;
      }
    }
    
    // Remove printing class from body
    document.body.classList.remove('printing-payroll');
    
    // Restore employee initials circle visibility
    if (empInitialsEl) {
      empInitialsEl.style.display = originalInitialsDisplay || 'flex';
    }
    
    // Re-add attendance print styles to DOM
    if (attendancePrintStyles && attendancePrintStylesParent) {
      if (attendancePrintStylesNextSibling) {
        attendancePrintStylesParent.insertBefore(attendancePrintStyles, attendancePrintStylesNextSibling);
      } else {
        attendancePrintStylesParent.appendChild(attendancePrintStyles);
      }
    }
  }, 1000);
}

// ===== DELETE BREAKDOWN MODAL FUNCTIONS =====

// Show delete breakdown confirmation modal
function showDeleteBreakdownModal(recordId, period) {
  const modal = document.getElementById('deleteBreakdownModal');
  const infoEl = document.getElementById('deleteBreakdownInfo');
  const idEl = document.getElementById('deleteBreakdownId');
  
  if (!modal) return;
  
  if (infoEl) infoEl.textContent = `Period: ${period}`;
  if (idEl) idEl.value = recordId;
  
  modal.style.display = 'block';
}

// Close delete breakdown modal
function closeDeleteBreakdownModal() {
  const modal = document.getElementById('deleteBreakdownModal');
  if (modal) modal.style.display = 'none';
}

// Confirm and delete breakdown record
async function confirmDeleteBreakdown() {
  const idEl = document.getElementById('deleteBreakdownId');
  const recordId = idEl?.value;
  
  if (!recordId) {
    showNotification('No record selected for deletion', 'error');
    return;
  }
  
  try {
    // Use the API function with audit logging
    if (window.deletePayrollItemRecord) {
      await window.deletePayrollItemRecord(recordId);
    } else {
      // Fallback to direct API call (for backwards compatibility)
      const baseId = AIRTABLE_CONFIG.BASES.HUMAN_RESOURCES;
      const apiKey = AIRTABLE_CONFIG.API_KEY;
      const table = AIRTABLE_CONFIG.TABLES.PAYROLL_ITEMS;
      
      const url = `https://api.airtable.com/v0/${baseId}/${table}/${recordId}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete breakdown record');
      }
    }
    
    closeDeleteBreakdownModal();
    showNotification('Breakdown record deleted successfully', 'success');
    
    // Refresh breakdown history
    const empIdEl = document.getElementById('viewCompEmpId');
    if (empIdEl?.value) {
      await loadBreakdownHistory(empIdEl.value);
    }
    
  } catch (error) {
    console.error('Error deleting breakdown:', error);
    showNotification('Error deleting breakdown: ' + error.message, 'error');
  }
}
