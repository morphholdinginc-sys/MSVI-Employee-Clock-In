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

// Show/Hide Add Attendance Modal (align with overlay markup)
window.showAddAttendanceModal = async function() {
  const modal = document.getElementById('addAttendanceModal');
  if (!modal) return;
  const empIdInput = document.getElementById('addEmployeeId');
  const empNameEl = document.getElementById('addEmployeeName');
  const empDisplayIdEl = document.getElementById('addEmployeeDisplayId');
  if (empIdInput) empIdInput.value = currentEmployeeId || '';
  if (empNameEl) empNameEl.textContent = currentEmployeeName || '';
  if (empDisplayIdEl) empDisplayIdEl.textContent = currentEmployeeId ? `(ID: ${currentEmployeeId})` : '';
  
  // Disable double pay checkbox for fixed rate employees
  const employee = employeesMap.get(currentEmployeeId);
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const addDoublePayChk = document.getElementById('addIsDoublePay');
  const addDoublePayLabel = addDoublePayChk?.parentElement;
  if (addDoublePayChk) {
    addDoublePayChk.disabled = isFixed;
    addDoublePayChk.checked = false; // Reset checkbox
    if (isFixed && addDoublePayLabel) {
      addDoublePayLabel.innerHTML = '<input type="checkbox" id="addIsDoublePay" name="isDoublePay" disabled /><label for="addIsDoublePay" style="margin:0; color:#888;">Double Pay (Not applicable for Fixed Rate)</label>';
    } else if (addDoublePayLabel) {
      addDoublePayLabel.innerHTML = '<input type="checkbox" id="addIsDoublePay" name="isDoublePay" /><label for="addIsDoublePay" style="margin:0;">Double Pay (Sunday/Holiday)</label>';
    }
  }
  
  // Show/Hide lunch adjustment badge
  const lunchBadge = document.getElementById('addLunchAdjustmentBadge');
  if (lunchBadge) {
    const empStandardWeeklyHours = Number(employee?.standardWorkweekHours) || 40;
    const empScheduleSpan = getScheduleSpanHours(employee?.coreWorkingHours);
    const empDailyFromWeekly = empStandardWeeklyHours / 7;
    const hasLunchAdjustment = empScheduleSpan !== null && empScheduleSpan === empDailyFromWeekly && empScheduleSpan > 8;
    if (hasLunchAdjustment) {
      lunchBadge.style.display = 'block';
      const scheduleDisplay = document.getElementById('addScheduleDisplay');
      const actualWorkDisplay = document.getElementById('addActualWorkDisplay');
      if (scheduleDisplay) scheduleDisplay.textContent = `${empScheduleSpan} hrs`;
      if (actualWorkDisplay) actualWorkDisplay.textContent = `${empScheduleSpan - 1} hrs`;
    } else {
      lunchBadge.style.display = 'none';
    }
  }
  
  // Ensure submit handler is attached even if DOMContentLoaded already fired
  const addForm = document.getElementById('addAttendanceForm');
  if (addForm) {
    addForm.onsubmit = handleAddAttendanceSubmit;
  }
  modal.style.display = 'block';
};

window.hideAddAttendanceModal = function() {
  const modal = document.getElementById('addAttendanceModal');
  if (modal) modal.style.display = 'none';
};

// ===== BATCH ADD ATTENDANCE FUNCTIONS =====
let batchPreviewDates = [];

window.showBatchAddAttendanceModal = function() {
  const modal = document.getElementById('batchAddAttendanceModal');
  if (!modal) return;
  
  // Pre-fill employee info
  const empIdInput = document.getElementById('batchEmployeeId');
  const empNameEl = document.getElementById('batchEmployeeName');
  const empDisplayIdEl = document.getElementById('batchEmployeeDisplayId');
  if (empIdInput) empIdInput.value = currentEmployeeId || '';
  if (empNameEl) empNameEl.textContent = currentEmployeeName || '';
  if (empDisplayIdEl) empDisplayIdEl.textContent = currentEmployeeId ? `(ID: ${currentEmployeeId})` : '';
  
  // Disable batch double pay checkbox for fixed rate employees
  const employee = employeesMap.get(currentEmployeeId);
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const batchDoublePayChk = document.getElementById('batchDoublePaySunday');
  const batchDoublePayLabel = batchDoublePayChk?.closest('label');
  if (batchDoublePayChk) {
    batchDoublePayChk.disabled = isFixed;
    batchDoublePayChk.checked = false; // Reset checkbox
    if (batchDoublePayLabel) {
      const span = batchDoublePayLabel.querySelector('span');
      if (span) {
        span.textContent = isFixed ? 'Double Pay (Not applicable for Fixed Rate)' : 'Double Pay for Sundays';
        span.style.color = isFixed ? '#888' : '#fff';
      }
    }
  }
  
  // Set default dates (current month)
  const now = new Date();
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  document.getElementById('batchStartDate').value = firstDay.toISOString().slice(0, 10);
  document.getElementById('batchEndDate').value = lastDay.toISOString().slice(0, 10);
  
  // Reset preview and progress
  document.getElementById('batchPreviewSection').style.display = 'none';
  document.getElementById('batchProgressSection').style.display = 'none';
  batchPreviewDates = [];
  
  // Attach form handler
  const form = document.getElementById('batchAddAttendanceForm');
  if (form && !form.__handlerBound) {
    form.addEventListener('submit', handleBatchAddSubmit);
    form.__handlerBound = true;
  }
  
  modal.style.display = 'block';
};

// Cancellation flag for batch add
let batchAddCancelled = false;

window.closeBatchAddAttendanceModal = function() {
  const modal = document.getElementById('batchAddAttendanceModal');
  if (modal) modal.style.display = 'none';
  // Reset form
  document.getElementById('batchAddAttendanceForm')?.reset();
  document.getElementById('batchPreviewSection').style.display = 'none';
  document.getElementById('batchProgressSection').style.display = 'none';
  batchPreviewDates = [];
  batchAddCancelled = false;
};

// Cancel batch add operation
window.cancelBatchAddAttendance = function() {
  const progressSection = document.getElementById('batchProgressSection');
  // If operation is in progress, set cancel flag
  if (progressSection && progressSection.style.display === 'block') {
    batchAddCancelled = true;
    showAttendanceNotification('Cancelling batch add...', 'info');
  } else {
    // Just close the modal if not in progress
    window.closeBatchAddAttendanceModal();
  }
};

// Close batch preview section
window.closeBatchPreview = function() {
  document.getElementById('batchPreviewSection').style.display = 'none';
  batchPreviewDates = [];
};

// Toggle individual preview item (exclude/include from batch)
window.toggleBatchPreviewItem = function(index, isChecked) {
  if (batchPreviewDates[index]) {
    batchPreviewDates[index].excluded = !isChecked;
    updateBatchPreviewCount();
  }
};

// Update preview count based on checked items
function updateBatchPreviewCount() {
  const toAdd = batchPreviewDates.filter(d => !d.skipped && !d.excluded);
  const toSkip = batchPreviewDates.filter(d => d.skipped);
  const excluded = batchPreviewDates.filter(d => d.excluded && !d.skipped);
  
  let countText = `${toAdd.length} records to add`;
  if (toSkip.length > 0) countText += `, ${toSkip.length} skipped`;
  if (excluded.length > 0) countText += `, ${excluded.length} excluded`;
  
  document.getElementById('batchPreviewCount').textContent = countText;
}

window.generateBatchPreview = async function() {
  const startDate = new Date(document.getElementById('batchStartDate').value);
  const endDate = new Date(document.getElementById('batchEndDate').value);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    showAttendanceNotification('Please select valid start and end dates.', 'warning');
    return;
  }
  
  if (startDate > endDate) {
    showAttendanceNotification('Start date must be before end date.', 'warning');
    return;
  }
  
  // Get selected days (0=Sun, 1=Mon, ..., 6=Sat)
  const selectedDays = [];
  if (document.getElementById('batchSun').checked) selectedDays.push(0);
  if (document.getElementById('batchMon').checked) selectedDays.push(1);
  if (document.getElementById('batchTue').checked) selectedDays.push(2);
  if (document.getElementById('batchWed').checked) selectedDays.push(3);
  if (document.getElementById('batchThu').checked) selectedDays.push(4);
  if (document.getElementById('batchFri').checked) selectedDays.push(5);
  if (document.getElementById('batchSat').checked) selectedDays.push(6);
  
  if (selectedDays.length === 0) {
    showAttendanceNotification('Please select at least one day of the week.', 'warning');
    return;
  }
  
  const skipExisting = document.getElementById('batchSkipExisting').checked;
  const employeeId = document.getElementById('batchEmployeeId').value;
  
  // Get existing records if we need to skip duplicates
  let existingDates = new Set();
  if (skipExisting) {
    const allRecords = await getAll({ employeeId });
    (Array.isArray(allRecords) ? allRecords : []).forEach(r => {
      if (r.date) {
        const d = new Date(r.date);
        existingDates.add(d.toISOString().slice(0, 10));
      }
    });
  }
  
  // Generate dates
  batchPreviewDates = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    
    if (selectedDays.includes(dayOfWeek)) {
      const isSkipped = skipExisting && existingDates.has(dateStr);
      batchPreviewDates.push({
        date: dateStr,
        dayOfWeek,
        skipped: isSkipped,
        reason: isSkipped ? 'Already exists' : null
      });
    }
    current.setDate(current.getDate() + 1);
  }
  
  // Render preview
  const previewSection = document.getElementById('batchPreviewSection');
  const previewList = document.getElementById('batchPreviewList');
  const previewCount = document.getElementById('batchPreviewCount');
  
  const toAdd = batchPreviewDates.filter(d => !d.skipped);
  const toSkip = batchPreviewDates.filter(d => d.skipped);
  
  previewCount.textContent = `${toAdd.length} records to add${toSkip.length > 0 ? `, ${toSkip.length} skipped` : ''}`;
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  previewList.innerHTML = batchPreviewDates.map((d, index) => {
    const dateObj = new Date(d.date);
    const formatted = dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    if (d.skipped) {
      return `<div style="display:flex; align-items:center; padding:0.5rem 0.75rem; margin-bottom:0.35rem; background:rgba(255,193,7,0.1); border:1px solid rgba(255,193,7,0.25); border-radius:6px; color:#ffc107;">
        <span style="opacity:0.8; font-size:0.9rem;">⚠️ ${formatted}</span>
        <span style="margin-left:auto; font-size:0.75rem; background:rgba(255,193,7,0.2); padding:0.15rem 0.5rem; border-radius:10px;">Skipped</span>
      </div>`;
    }
    return `<label style="display:flex; align-items:center; padding:0.5rem 0.75rem; margin-bottom:0.35rem; background:rgba(102,255,178,0.05); border:1px solid rgba(102,255,178,0.15); border-radius:6px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(102,255,178,0.1)'" onmouseout="this.style.background='rgba(102,255,178,0.05)'">
      <input type="checkbox" checked data-preview-index="${index}" style="width:18px; height:18px; accent-color:#198754; margin-right:0.75rem; cursor:pointer;" onchange="window.toggleBatchPreviewItem?.(${index}, this.checked)" />
      <span style="color:#66ffb2; font-size:0.9rem;">${formatted}</span>
    </label>`;
  }).join('');
  
  previewSection.style.display = 'block';
  
  if (toAdd.length === 0) {
    showAttendanceNotification('No new records to add. All dates already have attendance records.', 'info');
  }
};

async function handleBatchAddSubmit(event) {
  event.preventDefault();
  
  const toAdd = batchPreviewDates.filter(d => !d.skipped && !d.excluded);
  if (toAdd.length === 0) {
    showAttendanceNotification('No records to add. Please click Preview first or select some dates.', 'warning');
    return;
  }
  
  const submitBtn = document.getElementById('batchSubmitBtn');
  const originalText = submitBtn?.textContent || 'Add All Records';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';
  }
  
  // Hide preview button during operation
  const previewBtn = document.getElementById('batchPreviewBtn');
  if (previewBtn) previewBtn.style.display = 'none';
  
  // Reset cancel flag
  batchAddCancelled = false;
  
  // Show progress section
  const progressSection = document.getElementById('batchProgressSection');
  const progressText = document.getElementById('batchProgressText');
  const progressCount = document.getElementById('batchProgressCount');
  const progressBar = document.getElementById('batchProgressBar');
  const progressPercent = document.getElementById('batchProgressPercent');
  const progressDetails = document.getElementById('batchProgressDetails');
  progressSection.style.display = 'block';
  
  // Get form values
  const employeeId = document.getElementById('batchEmployeeId').value;
  const timeInAM = document.getElementById('batchTimeInAM').value;
  const timeOutAM = document.getElementById('batchTimeOutAM').value;
  const timeInPM = document.getElementById('batchTimeInPM').value;
  const timeOutPM = document.getElementById('batchTimeOutPM').value;
  const remarks = ''; // Remarks field removed
  const doublePaySunday = document.getElementById('batchDoublePaySunday').checked;
  
  const employee = employeesMap.get(employeeId);
  const standardWorkweekHours = employee?.standardWorkweekHours || 40;
  // Determine if Fixed rate type
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  // Daily standard hours = Standard Workweek Hours / 7 days
  const dailyStandardHours = standardWorkweekHours / 7;
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < toAdd.length; i++) {
    // Check for cancellation
    if (batchAddCancelled) {
      progressText.textContent = 'Cancelled';
      if (progressDetails) {
        progressDetails.querySelector('span:first-child').textContent = `⚠️ Cancelled after ${successCount} records`;
      }
      break;
    }
    
    const dateInfo = toAdd[i];
    const percent = Math.round(((i + 1) / toAdd.length) * 100);
    progressText.textContent = `Adding record ${i + 1} of ${toAdd.length}...`;
    progressCount.textContent = `${i + 1} / ${toAdd.length}`;
    progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressDetails) {
      progressDetails.querySelector('span:first-child').textContent = `⏱️ Processing ${dateInfo.date}...`;
    }
    
    try {
      // Calculate hours
      let totalMinutes = 0;
      if (timeInAM && timeOutAM) {
        const [inH, inM] = timeInAM.split(':').map(Number);
        const [outH, outM] = timeOutAM.split(':').map(Number);
        totalMinutes += (outH * 60 + outM) - (inH * 60 + inM);
      }
      if (timeInPM && timeOutPM) {
        const [inH, inM] = timeInPM.split(':').map(Number);
        const [outH, outM] = timeOutPM.split(':').map(Number);
        totalMinutes += (outH * 60 + outM) - (inH * 60 + inM);
      }
      
      const hasAM = !!(timeInAM && timeOutAM);
      const hasPM = !!(timeInPM && timeOutPM);
      
      // Calculate actual work hours first
      let actualWorkHours = totalMinutes / 60;
      
      // Get schedule span from coreWorkingHours (e.g., "8:00 AM - 6:00 PM" = 10 hours)
      const scheduleSpan = getScheduleSpanHours(employee?.coreWorkingHours);
      
      // Add 1-hour lunch break only if:
      // 1. Both AM and PM shifts are worked
      // 2. Schedule span exists and is >= daily standard (indicates lunch may be included in span)
      // 3. Actual work hours < daily standard hours (need to add lunch to reach standard)
      if (hasAM && hasPM && scheduleSpan && scheduleSpan >= dailyStandardHours && actualWorkHours < dailyStandardHours) {
        totalMinutes += 60;
      }
      
      let totalHoursWorked = totalMinutes / 60;
      const overtimeHours = isFixed ? 0 : Math.max(0, totalHoursWorked - dailyStandardHours);
      
      let overTimePay = 0;
      if (!isFixed && overtimeHours > 0) {
        const hourlyRate = calculateHourlyRate(employee);
        overTimePay = overtimeHours * hourlyRate * 1.25;
      }
      
      const isSunday = dateInfo.dayOfWeek === 0;
      // Fixed rate employees cannot have double pay
      const isDoublePay = isFixed ? false : (doublePaySunday && isSunday);
      
      const isAbsent = !hasAM && !hasPM;
      const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM);
      
      const attendanceData = {
        employeeId,
        date: dateInfo.date,
        timeInAM: timeInAM || '',
        timeOutAM: timeOutAM || '',
        timeInPM: timeInPM || '',
        timeOutPM: timeOutPM || '',
        remarks: remarks + (isDoublePay ? ' (Double Pay)' : ''),
        isDoublePay,
        totalHoursWorked,
        overtimeHours,
        overTimePay,
        lunchBreak: (!isHalfDay && !isAbsent) ? 60 : 0
      };
      
      await add(attendanceData);
      successCount++;
    } catch (err) {
      console.error('Error adding batch record:', dateInfo.date, err);
      errorCount++;
    }
  }
  
  // Complete
  const wasCancelled = batchAddCancelled;
  
  if (!wasCancelled) {
    progressText.textContent = 'Complete!';
    progressBar.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressDetails) {
      progressDetails.querySelector('span:first-child').textContent = errorCount === 0 
        ? `✅ Successfully added ${successCount} records` 
        : `⚠️ ${successCount} added, ${errorCount} failed`;
    }
  }
  
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
  
  // Restore preview button
  if (previewBtn) previewBtn.style.display = '';
  
  // Reset cancel flag
  batchAddCancelled = false;
  
  // Show result notification
  if (wasCancelled) {
    showAttendanceNotification(`Batch add cancelled. ${successCount} records were added before cancellation.`, 'warning');
  } else if (errorCount === 0) {
    showAttendanceNotification(`Successfully added ${successCount} attendance records!`, 'success');
  } else {
    showAttendanceNotification(`Added ${successCount} records, ${errorCount} failed.`, 'warning');
  }
  
  // Close modal and refresh
  window.closeBatchAddAttendanceModal();
  await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
  await window.updateTodaySummaryBar();
}

// ===== END BATCH ADD ATTENDANCE FUNCTIONS =====

// Ensure clearAttendanceFilters is globally available for dynamic loading
window.clearAttendanceFilters = function() {
  // Reset all attendance filters to default values
  document.getElementById('attendanceNameFilter').value = '';
  document.getElementById('attendanceDepartmentFilter').value = '';
  document.getElementById('attendanceDateFilter').value = 'today';
  document.getElementById('attendanceStatusFilter').value = '';
  document.getElementById('attendanceLocationFilter').value = '';
  // Optionally clear filter summary
  if (document.getElementById('attendanceFilterSummary')) {
    document.getElementById('attendanceFilterSummary').textContent = '';
  }
  // Re-apply filters if function exists
  if (typeof window.applyAttendanceFilters === 'function') {
    window.applyAttendanceFilters();
  }
};

// Use window exports from attendance-api.js (loaded as regular script)
const getAll = (...args) => window.attendanceApiGetAll ? window.attendanceApiGetAll(...args) : Promise.reject('attendanceApiGetAll not loaded');
const getById = (...args) => window.attendanceApiGetById ? window.attendanceApiGetById(...args) : Promise.reject('attendanceApiGetById not loaded');
const add = (...args) => window.attendanceApiAdd ? window.attendanceApiAdd(...args) : Promise.reject('attendanceApiAdd not loaded');
const update = (...args) => window.attendanceApiUpdate ? window.attendanceApiUpdate(...args) : Promise.reject('attendanceApiUpdate not loaded');
const remove = (...args) => window.attendanceApiDelete ? window.attendanceApiDelete(...args) : Promise.reject('attendanceApiDelete not loaded');
const exists = (...args) => window.attendanceApiExists ? window.attendanceApiExists(...args) : Promise.reject('attendanceApiExists not loaded');

// Use window exports from employees-api.js for loading employees
const hrApiGetAll = () => window.hrApiGetAll ? window.hrApiGetAll() : Promise.reject('hrApiGetAll not loaded');

let employees = [];
let currentEmployeeId = null;
let currentEmployeeName = null;
let attendanceToDelete = null;
let allAttendanceRecords = [];
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let employeesMap = new Map();

// Multi-select state for bulk delete attendance records
let selectedAttendanceIds = new Set();

// Pagination state for attendance employee list
let attendanceCurrentPage = 1;
let attendancePageSize = 10;
let filteredAttendanceEmployees = [];

// Helpers for formatting and month names
function formatTime(timeString) {
  if (!timeString) return '-';
  const time = new Date(`2000-01-01T${timeString}`);
  if (isNaN(time.getTime())) return timeString;
  return time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Format decimal hours to "Xh Ym" format (e.g., 10.25 -> "10h 15m")
function formatHoursMinutes(decimalHours) {
  if (decimalHours == null || isNaN(decimalHours) || decimalHours <= 0) return '-';
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  if (hours === 0 && minutes === 0) return '-';
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// Notification Modal helper functions
function showAttendanceNotification(message, type = 'success', title = null) {
  let modal = document.getElementById('attendanceNotificationModal');
  
  // Create modal dynamically if it doesn't exist
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'attendanceNotificationModal';
    modal.className = 'modal';
    modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; justify-content:center; align-items:center;';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:400px; text-align:center; background:#113d2a; border:1px solid #275b48; border-radius:8px; padding:2rem;">
        <div id="attendanceNotificationIcon" style="font-size:3rem; margin-bottom:1rem;">✅</div>
        <h3 id="attendanceNotificationTitle" style="margin:0 0 0.5rem; color:#fff;">Success</h3>
        <p id="attendanceNotificationMessage" style="margin:0 0 1.5rem; color:#ccc;">Operation completed successfully.</p>
        <button class="btn-primary" onclick="window.closeAttendanceNotificationModal?.()" style="background:#198754; color:#fff; border:none; padding:0.5rem 1.5rem; border-radius:4px; cursor:pointer;">OK</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  const iconEl = document.getElementById('attendanceNotificationIcon');
  const titleEl = document.getElementById('attendanceNotificationTitle');
  const messageEl = document.getElementById('attendanceNotificationMessage');
  
  if (type === 'success') {
    iconEl.textContent = '✅';
    iconEl.style.color = '#16a34a';
    titleEl.textContent = title || 'Success';
    titleEl.style.color = '#16a34a';
  } else if (type === 'error') {
    iconEl.textContent = '❌';
    iconEl.style.color = '#ea580c';
    titleEl.textContent = title || 'Error';
    titleEl.style.color = '#ea580c';
  } else if (type === 'warning') {
    iconEl.textContent = '⚠️';
    iconEl.style.color = '#ffc107';
    titleEl.textContent = title || 'Warning';
    titleEl.style.color = '#ffc107';
  } else if (type === 'info') {
    iconEl.textContent = 'ℹ️';
    iconEl.style.color = '#2563eb';
    titleEl.textContent = title || 'Info';
    titleEl.style.color = '#2563eb';
  }
  
  messageEl.textContent = message;
  modal.style.display = 'flex';
}

window.closeAttendanceNotificationModal = function() {
  const modal = document.getElementById('attendanceNotificationModal');
  if (modal) modal.style.display = 'none';
};

function getMonthName(m) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][Math.max(0,Math.min(11,(m-1)||0))];
}

function filterRecordsByMonth(records, month, year) {
  if (!Array.isArray(records)) return [];
  return records.filter(r => {
    if (!r || !r.date) return false;
    const d = new Date(r.date);
    if (isNaN(d.getTime())) return false;
    const recordMonth = d.getMonth() + 1;
    const recordYear = d.getFullYear();
    return recordMonth === month && recordYear === year;
  });
}

function calculateHourlyRate(emp) {
  const base = Number(emp?.baseSalary) || 0;
  if (!base) return 0;
  const standard = Number(emp?.standardWorkweekHours) || 40;
  // Daily standard hours = Standard Workweek Hours / 7 days
  const daily = standard / 7;
  const dailyRate = base / 30;
  return dailyRate / daily;
}

async function calculateOvertimePay(employeeId, overtimeHours) {
  const emp = employeesMap.get(employeeId);
  if (!emp) return 0;
  if (String(emp.rateType).toLowerCase() === 'fixed') return 0;
  const hr = calculateHourlyRate(emp);
  return (Number(overtimeHours)||0) * hr * 1.25;
}

function calculateMonthlySummary(records, emp) {
  // Ensure records is an array
  const safeRecords = Array.isArray(records) ? records : [];
  const standard = Number(emp?.standardWorkweekHours) || 40;
  // Determine if Fixed rate type
  const rateType = (emp?.rateType || '').toLowerCase();
  const empType = (emp?.employmentType || emp?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  // Daily standard hours = Standard Workweek Hours / 7 days
  const dailyStd = standard / 7;
  const tol = 0.01;
  const sum = { totalDays: safeRecords.length, presentDays:0, absentDays:0, overtimeDays:0, shortHoursDays:0, totalHours:0, totalOvertime:0, totalOvertimePay:0, dailyStandardHours: dailyStd, fullDays:0, leaveUsed:0, invalidDays:0 };
  safeRecords.forEach(r => {
    const total = Number(r.totalHoursWorked)||0;
    const ot = Number(r.overtimeHours)||0;
    const leaveType = r.leaveType || '';
    
    // If on leave (not 'None' or empty), count as leave day
    if (leaveType && leaveType !== 'None' && leaveType !== '') {
      sum.leaveUsed++;
      sum.presentDays++; // Leave counts as present
      return;
    }
    
    // status
    let status = 'Present';
    const hasAM = r.timeInAM && r.timeOutAM;
    const hasPM = r.timeInPM && r.timeOutPM;
    
    // Minimum hours thresholds
    const minHoursForHalfDay = dailyStd / 2 * 0.75; // At least 75% of half day (e.g., 3 hours for 8-hour day)
    const minHoursForValid = 0.5; // At least 30 minutes to count as valid work
    
    if (!hasAM && !hasPM) status = 'Absent';
    else if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
      // Only AM or PM - check if enough hours for Half Day
      if (total < minHoursForValid) {
        status = 'Invalid'; // Too short to count (e.g., 5 minutes)
      } else if (total < minHoursForHalfDay) {
        status = 'Short Hours'; // Some work but not enough for half day
      } else {
        status = 'Half Day';
      }
    }
    else if (total < (dailyStd - tol)) status = 'Short Hours';
    else if (total > (dailyStd + tol)) status = 'Overtime';

    if (status === 'Present' || status === 'Overtime' || status === 'Short Hours' || status === 'Half Day') sum.presentDays++;
    if (status === 'Absent') sum.absentDays++;
    if (status === 'Invalid') sum.invalidDays++;
    if (status === 'Overtime') sum.overtimeDays++;
    if (status === 'Short Hours') sum.shortHoursDays++;
    // Full days: count days where employee worked full day (Present or Overtime - not Half Day, Absent, or Short Hours)
    if (status === 'Present' || status === 'Overtime') sum.fullDays++;
    sum.totalHours += total;
    sum.totalOvertime += ot;
    if (ot > 0 && !isFixed) {
      const hr = calculateHourlyRate(emp);
      sum.totalOvertimePay += ot * hr * 1.25;
    }
  });
  return sum;
}

// Initialize department filter dropdown
async function initializeDepartmentFilter() {
  const departmentFilter = document.getElementById('attendanceDepartmentFilter');
  if (!departmentFilter) return;
  
  if (window.DepartmentsAPI) {
    try {
      const departments = await window.DepartmentsAPI.fetchAllDepartments();
      const currentValue = departmentFilter.value;
      departmentFilter.innerHTML = '<option value="">All Departments</option>';
      
      departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept.departmentName;
        option.textContent = dept.departmentName;
        departmentFilter.appendChild(option);
      });
      
      // Restore selected value if any
      if (currentValue) {
        departmentFilter.value = currentValue;
      }
      console.log('[Attendance] Department filter populated with', departments.length, 'departments');
    } catch (err) {
      console.error('[Attendance] Failed to load departments for filter:', err);
    }
  }
}

// Initialization flag to prevent duplicate event listeners
let attendanceInitialized = false;

// Initialize function
async function initAttendance() {
  console.log('[Attendance] Initializing...');
  // Initialize department filter dropdown
  await initializeDepartmentFilter();
  
  if (document.getElementById('attendanceEmployeeTableBody')) {
    await loadEmployeesForAttendance();
  }
  
  // Only attach event listeners once
  if (!attendanceInitialized) {
    // Setup form listeners using onsubmit to prevent duplicates
    const editForm = document.getElementById('editAttendanceForm');
    const addForm = document.getElementById('addAttendanceForm');
    if (editForm) editForm.onsubmit = handleEditAttendanceSubmit;
    if (addForm) addForm.onsubmit = handleAddAttendanceSubmit;
    
    attendanceInitialized = true;
    console.log('[Attendance] Event listeners attached');
  }
  
  await updateTodaySummaryBar();
}

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAttendance);
} else {
  initAttendance();
}

// Dynamically update summary bar metrics for today
async function updateTodaySummaryBar() {
  console.log('[Summary] updateTodaySummaryBar called');
  // Show loading state
  const elPresent = document.getElementById('presentToday');
  const elAbsent = document.getElementById('absentToday');
  const elLate = document.getElementById('lateToday');
  const elWfh = document.getElementById('workingFromHome');
  const elLeave = document.getElementById('onLeaveToday');
  if (elPresent) elPresent.textContent = '--';
  if (elAbsent) elAbsent.textContent = '--';
  if (elLate) elLate.textContent = '--';
  if (elWfh) elWfh.textContent = '--';
  if (elLeave) elLeave.textContent = '--';

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  
  // Get all employees directly from the API
  let allEmployees = [];
  try {
    allEmployees = await hrApiGetAll();
    console.log('[Summary] Total employees:', allEmployees.length);
  } catch (e) {
    console.error('[Summary] Error loading employees:', e);
    allEmployees = [];
  }
  
  // Always fetch all attendance, then filter client-side for today's date
  let records = [];
  try {
    const fetched = await getAll({});
    records = Array.isArray(fetched) ? fetched : [];
    console.log('[Summary] Fetched attendance records:', records.length);
  } catch (e) {
    console.error('[Summary] Error fetching attendance:', e);
    records = [];
  }
  
  // Filter for today's records
  const todayRecords = records.filter(r => {
    if (!r || !r.date) return false;
    const d = new Date(r.date);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  });
  console.log('[Summary] Records for today:', todayRecords.length);
  
  // Create a map of today's attendance by employee ID
  const todayAttendanceMap = new Map();
  todayRecords.forEach(r => {
    if (r.employeeId) {
      todayAttendanceMap.set(r.employeeId, r);
    }
  });
  
  // Calculate metrics
  let present = 0, absent = 0, late = 0, wfh = 0, onLeave = 0;
  const LATE_THRESHOLD_MINUTES = 9 * 60 + 15; // 09:15 AM
  
  // Count based on all employees
  const totalEmployees = allEmployees.length || todayRecords.length;
  
  todayRecords.forEach(r => {
    const remarks = (r.remarks || '').toLowerCase();
    const hasAM = !!(r.timeInAM || r.timeOutAM);
    const hasPM = !!(r.timeInPM || r.timeOutPM);
    const isAbsentRecord = !hasAM && !hasPM;
    
    // Late detection: AM time-in after 09:15 or remarks include 'late'
    let isLate = false;
    if (r.timeInAM) {
      const [h, m] = String(r.timeInAM).split(':').map(Number);
      const mins = (h||0) * 60 + (m||0);
      if (mins > LATE_THRESHOLD_MINUTES) isLate = true;
    }
    if (remarks.includes('late')) isLate = true;

    if (remarks.includes('leave') || remarks.includes('on leave')) {
      onLeave++;
    } else if (remarks.includes('work from home') || remarks.includes('wfh') || remarks.includes('remote')) {
      wfh++;
    } else if (remarks.includes('absent') || isAbsentRecord) {
      absent++;
    } else if (isLate) {
      late++;
    } else {
      present++;
    }
  });
  
  // Employees without attendance records today are considered absent
  if (allEmployees.length > 0) {
    const employeesWithoutAttendance = allEmployees.filter(emp => {
      const empId = emp.employeeId || emp.id;
      return !todayAttendanceMap.has(empId);
    });
    absent += employeesWithoutAttendance.length;
  }
  
  console.log('[Summary] Calculated:', { present, absent, late, wfh, onLeave, totalEmployees });
  
  // Update DOM
  if (elPresent) elPresent.textContent = String(present);
  if (elAbsent) elAbsent.textContent = String(absent);
  if (elLate) elLate.textContent = String(late);
  if (elWfh) elWfh.textContent = String(wfh);
  if (elLeave) elLeave.textContent = String(onLeave);
}

async function loadEmployeesForAttendance() {
  // Initialize department filter every time tab is loaded
  await initializeDepartmentFilter();
  
  const overlay = document.getElementById('loading_overlay');
  if (overlay) overlay.classList.add('active');
  const tbody = document.getElementById('attendanceEmployeeTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><div class="loading">Loading attendance directory...</div></td></tr>';
  
  try {
    // Load employees directly from the API
    employees = await hrApiGetAll();
    // Sort employees alphabetically by last name, then first name
    employees.sort((a, b) => {
      const lastNameA = (a.lastName || '').toLowerCase();
      const lastNameB = (b.lastName || '').toLowerCase();
      if (lastNameA !== lastNameB) return lastNameA.localeCompare(lastNameB);
      const firstNameA = (a.firstName || '').toLowerCase();
      const firstNameB = (b.firstName || '').toLowerCase();
      return firstNameA.localeCompare(firstNameB);
    });
    console.log('Loaded employees for attendance:', employees.length);
  } catch (err) {
    console.error('Failed to load employees:', err);
    employees = [];
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c53045;">Error: ${err.message} <button class="actions-btn" onclick="window.loadEmployeesForAttendance()">Retry</button></td></tr>`;
    }
  } finally {
    if (overlay) overlay.classList.remove('active');
  }
  
  employeesMap.clear();
  employees.forEach(emp => {
    employeesMap.set(emp.employeeId, emp);
  });
  
  // Load today's attendance status for display in table
  await loadTodayAttendanceStatus();
  
  filteredAttendanceEmployees = [...employees];
  attendanceCurrentPage = 1;
  renderAttendanceEmployeesPage();
}

// Pagination functions for attendance employee list
function renderAttendanceEmployeesPage() {
  const totalItems = filteredAttendanceEmployees.length;
  const totalPages = Math.ceil(totalItems / attendancePageSize) || 1;
  
  if (attendanceCurrentPage > totalPages) attendanceCurrentPage = totalPages;
  if (attendanceCurrentPage < 1) attendanceCurrentPage = 1;
  
  const startIndex = (attendanceCurrentPage - 1) * attendancePageSize;
  const endIndex = startIndex + attendancePageSize;
  const pageItems = filteredAttendanceEmployees.slice(startIndex, endIndex);
  
  renderEmployeesForAttendance(pageItems);
  updateAttendancePaginationControls(totalItems, totalPages, startIndex, endIndex);
}

function updateAttendancePaginationControls(totalItems, totalPages, startIndex, endIndex) {
  const pageInfo = document.getElementById('attendancePageInfo');
  const showingInfo = document.getElementById('attendanceShowingInfo');
  const prevBtn = document.getElementById('attendancePrevBtn');
  const nextBtn = document.getElementById('attendanceNextBtn');
  
  if (pageInfo) pageInfo.textContent = `Page ${attendanceCurrentPage} of ${totalPages}`;
  if (showingInfo) {
    const showEnd = Math.min(endIndex, totalItems);
    showingInfo.textContent = totalItems > 0 
      ? `Showing ${startIndex + 1}-${showEnd} of ${totalItems}` 
      : 'No records';
  }
  if (prevBtn) prevBtn.disabled = attendanceCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = attendanceCurrentPage >= totalPages;
}

window.changeAttendancePageSize = function() {
  const select = document.getElementById('attendancePageSize');
  if (select) {
    attendancePageSize = parseInt(select.value, 10) || 10;
    attendanceCurrentPage = 1;
    renderAttendanceEmployeesPage();
  }
};

window.prevAttendancePage = function() {
  if (attendanceCurrentPage > 1) {
    attendanceCurrentPage--;
    renderAttendanceEmployeesPage();
  }
};

window.nextAttendancePage = function() {
  const totalPages = Math.ceil(filteredAttendanceEmployees.length / attendancePageSize) || 1;
  if (attendanceCurrentPage < totalPages) {
    attendanceCurrentPage++;
    renderAttendanceEmployeesPage();
  }
};

// Store today's attendance map for status display
let todayAttendanceStatusMap = new Map();

// Load today's attendance records for status display
async function loadTodayAttendanceStatus() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    
    // Fetch all attendance records
    const records = await getAll({});
    const allRecords = Array.isArray(records) ? records : [];
    
    // Filter for today's records and build map
    todayAttendanceStatusMap.clear();
    allRecords.forEach(r => {
      if (!r || !r.date || !r.employeeId) return;
      const d = new Date(r.date);
      const recordDate = d.toISOString().slice(0, 10);
      if (recordDate === todayStr) {
        todayAttendanceStatusMap.set(r.employeeId, r);
      }
    });
    
    console.log('[Attendance] Loaded today attendance status for', todayAttendanceStatusMap.size, 'employees');
  } catch (err) {
    console.error('[Attendance] Error loading today attendance status:', err);
  }
}

// Get attendance status label and color for an employee
function getTodayAttendanceStatus(emp) {
  const record = todayAttendanceStatusMap.get(emp.employeeId);
  
  if (!record) {
    return { label: 'No Record', color: '#6c757d', icon: '⚪' };
  }
  
  const hasAM = !!(record.timeInAM && record.timeOutAM);
  const hasPM = !!(record.timeInPM && record.timeOutPM);
  const leaveType = record.leaveType || '';
  const remarks = (record.remarks || '').toLowerCase();
  const totalHours = Number(record.totalHoursWorked) || 0;
  
  // Check for leave
  if (leaveType && leaveType !== 'None' && leaveType !== '') {
    return { label: `On Leave (${leaveType})`, color: '#0dcaf0', icon: '📅' };
  }
  
  // Check for leave in remarks
  if (remarks.includes('leave') || remarks.includes('on leave')) {
    return { label: 'On Leave', color: '#0dcaf0', icon: '📅' };
  }
  
  // Check for absent
  if (!hasAM && !hasPM) {
    return { label: 'Absent', color: '#dc3545', icon: '❌' };
  }
  
  // Check for half day
  if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
    return { label: 'Half Day', color: '#ffc107', icon: '🕐' };
  }
  
  // Check for undertime (less than standard hours - assuming 8 hours standard)
  const standardHours = (emp.standardWorkweekHours || 40) / 7;
  if (totalHours > 0 && totalHours < (standardHours - 0.5)) {
    return { label: 'Undertime', color: '#fd7e14', icon: '⏱️' };
  }
  
  // Present
  return { label: 'Present', color: '#28a745', icon: '✅' };
}

function renderEmployeesForAttendance(list) {
  const tbody = document.getElementById('attendanceEmployeeTableBody');
  if (!tbody) return;
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No employees found.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(emp => {
    const idStr = emp.employeeId ? `'${emp.employeeId}'` : "''";
    const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
    const suffix = emp.suffix || '';
    const fullName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
    const nameStr = fullName.replace(/'/g, "\\'");
    const attendanceStatus = getTodayAttendanceStatus(emp);
    const rateType = emp.rateType || 'N/A';
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
        <td>${emp.positionTitle || ''}</td>
        <td class="employee-contract">${emp.employmentType || ''}</td>
        <td class="employee-rate-type">${rateType}</td>
        <td class="employee-status"><span style="color:${attendanceStatus.color}; font-weight:600;">${attendanceStatus.icon} ${attendanceStatus.label}</span></td>
        <td style="text-align:center;">
          <div class="actions-inline">
            <button class="actions-btn" onclick="window.viewEmployeeAttendance(${idStr}, '${nameStr}')">View Attendance</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// Refresh Attendance Directory
async function refreshAttendanceDirectory() {
  showAttendanceNotification('Refreshing attendance directory...', 'info');
  await loadEmployeesForAttendance();
  await loadTodayAttendanceStatus();
  showAttendanceNotification('Attendance directory refreshed!', 'success');
}

// Refresh Attendance Modal (for viewing individual employee attendance)
async function refreshAttendanceModal() {
  // Use stored employee data instead of parsing from DOM
  if (currentEmployeeId) {
    showAttendanceNotification('Refreshing attendance records...', 'info');
    // If name is undefined, get it from employeesMap
    let name = currentEmployeeName;
    if (!name || name === 'undefined') {
      const emp = employeesMap.get(currentEmployeeId);
      if (emp) {
        const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
        const suffix = emp.suffix || '';
        name = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
      }
    }
    await window.viewEmployeeAttendance(currentEmployeeId, name);
    showAttendanceNotification('Attendance records refreshed!', 'success');
  }
}

window.loadEmployeesForAttendance = loadEmployeesForAttendance;
window.renderEmployeesForAttendance = renderEmployeesForAttendance;
window.refreshAttendanceDirectory = refreshAttendanceDirectory;
window.refreshAttendanceModal = refreshAttendanceModal;


// Add Attendance
async function handleAddAttendanceSubmit(event) {
  event.preventDefault();
  
  // Get submit button and change text
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent || 'Add Attendance';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding Attendance...';
  }
  
  try {
    const formData = new FormData(event.target);
    const employeeId = formData.get('employeeId');
    // Normalize date to YYYY-MM-DD
    let date = formData.get('date');
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        date = d.toISOString().slice(0, 10);
      }
    }
    console.log('[Attendance] Checking for duplicate:', { employeeId, date });
    const alreadyExists = await exists(employeeId, date);
    console.log('[Attendance] Exists result:', alreadyExists);
    if (alreadyExists) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      window.showDuplicateAttendanceModal();
      return;
    }
    // Compute total hours, overtime, etc. (add your logic here)
    const timeInAM = formData.get('timeInAM');
    const timeOutAM = formData.get('timeOutAM');
    const timeInPM = formData.get('timeInPM');
    const timeOutPM = formData.get('timeOutPM');
    const remarks = formData.get('remarks') || '';
  let totalMinutes = 0;
  if (timeInAM && timeOutAM) {
    const [inHour, inMinute] = timeInAM.split(':').map(Number);
    const [outHour, outMinute] = timeOutAM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  if (timeInPM && timeOutPM) {
    const [inHour, inMinute] = timeInPM.split(':').map(Number);
    const [outHour, outMinute] = timeOutPM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  // Determine status
  const hasAM = !!(timeInAM && timeOutAM);
  const hasPM = !!(timeInPM && timeOutPM);
  
  const employee = employeesMap.get(employeeId);
  const standardWorkweekHours = employee?.standardWorkweekHours || 40;
  // If Core Working Hours span equals daily standard and > 8 hrs, lunch break wasn't accounted for
  const scheduleSpan = getScheduleSpanHours(employee?.coreWorkingHours);
  const dailyFromWeekly = standardWorkweekHours / 7;
  let dailyStandardHours = dailyFromWeekly;
  if (scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8) {
    dailyStandardHours = dailyFromWeekly - 1; // Subtract 1 hour for lunch
  }
  
  // Total hours = AM session + PM session (no lunch adjustment needed)
  // Lunch break is naturally excluded since we calculate each session separately
  
  const isAbsent = !hasAM && !hasPM || (remarks.toLowerCase().includes('absent'));
  const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM) || (!isAbsent && totalMinutes < 240);
  let totalHoursWorked = totalMinutes / 60;
  // Determine if Fixed rate type
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const overtimeHours = isFixed ? 0 : Math.max(0, totalHoursWorked - dailyStandardHours);
  // Calculate overtime pay for time-based employees
  let overTimePay = 0;
  if (!isFixed && overtimeHours > 0) {
    const hourlyRate = calculateHourlyRate(employee);
    overTimePay = overtimeHours * hourlyRate * 1.25;
  }
  // Get leave type
  const leaveType = document.getElementById('addLeaveType')?.value || 'None';
  
  // Fixed rate employees cannot have double pay
  let isDoublePay = document.getElementById('addIsDoublePay')?.checked || false;
  if (isFixed) {
    isDoublePay = false;
  }
  
  const attendanceData = {
    employeeId,
    date,
    timeInAM,
    timeOutAM,
    timeInPM,
    timeOutPM,
    remarks,
    isDoublePay,
    totalHoursWorked,
    overtimeHours,
    overTimePay,
    lunchBreak: (!isHalfDay && !isAbsent) ? 60 : 0,
    leaveType
  };
    console.log('[Attendance] Adding attendance with data:', attendanceData);
    const addResult = await add(attendanceData);
    console.log('[Attendance] Add result:', addResult);
    
    // Deduct leave from employee's balance if leave type is not 'None'
    if (leaveType && leaveType !== 'None' && employee) {
      try {
        const hrApiUpdate = window.hrApiUpdate;
        const updateData = {};
        
        if (leaveType === 'Vacation') {
          const currentVacation = employee.vacationDays || 0;
          if (currentVacation > 0) {
            updateData.vacationDays = currentVacation - 1;
          }
        } else if (leaveType === 'Sick') {
          const currentSick = employee.sickDays || 0;
          if (currentSick > 0) {
            updateData.sickDays = currentSick - 1;
          }
        } else if (leaveType === 'Personal') {
          const currentPersonal = employee.personalDays || 0;
          if (currentPersonal > 0) {
            updateData.personalDays = currentPersonal - 1;
          }
        }
        
        // Only update if there's something to change
        if (Object.keys(updateData).length > 0) {
          await hrApiUpdate(employee.id, updateData);
          console.log('[Attendance] Deducted leave from employee:', updateData);
        }
      } catch (err) {
        console.error('[Attendance] Failed to deduct leave:', err);
      }
    }
    showAttendanceNotification('Attendance record added successfully.', 'success');
    event.target.reset();
    // Close using the markup-consistent closer
    window.hideAddAttendanceModal();
    console.log('[Attendance] Refreshing view for:', currentEmployeeId, currentEmployeeName);
    await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
    await window.updateTodaySummaryBar();
  } catch (err) {
    console.error('Error adding attendance:', err);
    showAttendanceNotification('Failed to add attendance record: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}


// Helper function to reset the edit attendance submit button
function resetEditAttendanceButton() {
  const submitBtn = document.querySelector('#editAttendanceForm button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
}

// Edit Attendance
async function handleEditAttendanceSubmit(event) {
  event.preventDefault();
  
  // Get submit button and change text - use document.querySelector for reliability after form clone
  const submitBtn = document.querySelector('#editAttendanceForm button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
  }
  
  try {
    const formData = new FormData(event.target);
    const attendanceId = formData.get('id');
    const employeeId = formData.get('employeeId');
    const newDate = formData.get('date');
  
    // Check for duplicate date (excluding current record)
    const allRecords = await getAll();
    const duplicateExists = allRecords.some(rec => 
      rec.id !== attendanceId && 
      rec.employeeId === employeeId && 
      rec.date === newDate
    );
  
    if (duplicateExists) {
      resetEditAttendanceButton();
      showAttendanceNotification('An attendance record already exists for this employee on ' + newDate + '. Please choose a different date.', 'warning');
      return;
    }
  
    // Compute total hours, overtime, etc. (add your logic here)
    const timeInAM = formData.get('timeInAM');
    const timeOutAM = formData.get('timeOutAM');
    const timeInPM = formData.get('timeInPM');
  const timeOutPM = formData.get('timeOutPM');
  const remarks = formData.get('remarks') || '';
  let totalMinutes = 0;
  if (timeInAM && timeOutAM) {
    const [inHour, inMinute] = timeInAM.split(':').map(Number);
    const [outHour, outMinute] = timeOutAM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  if (timeInPM && timeOutPM) {
    const [inHour, inMinute] = timeInPM.split(':').map(Number);
    const [outHour, outMinute] = timeOutPM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  // Determine status
  const hasAM = !!(timeInAM && timeOutAM);
  const hasPM = !!(timeInPM && timeOutPM);
  
  const employee = employeesMap.get(employeeId);
  const standardWorkweekHours = employee?.standardWorkweekHours || 40;
  // If Core Working Hours span equals daily standard and > 8 hrs, lunch break wasn't accounted for
  const scheduleSpan = getScheduleSpanHours(employee?.coreWorkingHours);
  const dailyFromWeekly = standardWorkweekHours / 7;
  let dailyStandardHours = dailyFromWeekly;
  if (scheduleSpan !== null && scheduleSpan === dailyFromWeekly && scheduleSpan > 8) {
    dailyStandardHours = dailyFromWeekly - 1; // Subtract 1 hour for lunch
  }
  
  // Total hours = AM session + PM session (no lunch adjustment needed)
  // Lunch break is naturally excluded since we calculate each session separately
  
  const isAbsent = !hasAM && !hasPM || (remarks.toLowerCase().includes('absent'));
  const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM) || (!isAbsent && totalMinutes < 240);
  let totalHoursWorked = totalMinutes / 60;
  // Determine if Fixed rate type
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const overtimeHours = isFixed ? 0 : Math.max(0, totalHoursWorked - dailyStandardHours);
  // Calculate overtime pay for time-based employees
  let overTimePay = 0;
  if (!isFixed && overtimeHours > 0) {
    const hourlyRate = calculateHourlyRate(employee);
    overTimePay = overtimeHours * hourlyRate * 1.25;
  }
  
  // Get leave type
  const leaveType = document.getElementById('editLeaveType')?.value || 'None';
  
  // Get the old record to check if leave type changed
  const oldRecord = await getById(attendanceId);
  const oldLeaveType = oldRecord?.leaveType || 'None';
  
  // Fixed rate employees cannot have double pay
  let isDoublePay = document.getElementById('editIsDoublePay')?.checked || false;
  if (isFixed) {
    isDoublePay = false;
  }
  
  const attendanceData = {
    employeeId,
    date: formData.get('date'),
    timeInAM,
    timeOutAM,
    timeInPM,
    timeOutPM,
    remarks,
    isDoublePay,
    totalHoursWorked,
    overtimeHours,
    overTimePay,
    lunchBreak: (!isHalfDay && !isAbsent) ? 60 : 0,
    leaveType
  };
    await update(attendanceId, attendanceData);
    
    // Handle leave balance changes if leave type changed
    if (leaveType !== oldLeaveType && employee) {
      try {
        const hrApiUpdate = window.hrApiUpdate;
        const updateData = {};
        
        // Refund old leave type
        if (oldLeaveType && oldLeaveType !== 'None') {
          if (oldLeaveType === 'Vacation') {
            updateData.vacationDays = (employee.vacationDays || 0) + 1;
          } else if (oldLeaveType === 'Sick') {
            updateData.sickDays = (employee.sickDays || 0) + 1;
          } else if (oldLeaveType === 'Personal') {
            updateData.personalDays = (employee.personalDays || 0) + 1;
          }
        }
        
        // Deduct new leave type
        if (leaveType && leaveType !== 'None') {
          if (leaveType === 'Vacation') {
            const currentVacation = updateData.vacationDays !== undefined ? updateData.vacationDays : (employee.vacationDays || 0);
            if (currentVacation > 0) {
              updateData.vacationDays = currentVacation - 1;
            }
          } else if (leaveType === 'Sick') {
            const currentSick = updateData.sickDays !== undefined ? updateData.sickDays : (employee.sickDays || 0);
            if (currentSick > 0) {
              updateData.sickDays = currentSick - 1;
            }
          } else if (leaveType === 'Personal') {
            const currentPersonal = updateData.personalDays !== undefined ? updateData.personalDays : (employee.personalDays || 0);
            if (currentPersonal > 0) {
              updateData.personalDays = currentPersonal - 1;
            }
          }
        }
        
        // Only update if there's something to change
        if (Object.keys(updateData).length > 0) {
          await hrApiUpdate(employee.id, updateData);
          console.log('[Attendance] Updated employee leave balance:', updateData);
        }
      } catch (err) {
        console.error('[Attendance] Failed to update leave balance:', err);
      }
    }
    
    showAttendanceNotification('Attendance record updated successfully.', 'success');
    event.target.reset();
    window.closeEditAttendanceModal();
    await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
    await window.updateTodaySummaryBar();
  } catch (err) {
    console.error('Error updating attendance:', err);
    showAttendanceNotification('Failed to update attendance record: ' + err.message, 'error');
  } finally {
    // Always reset button state using helper function
    resetEditAttendanceButton();
  }
}

// Example: Delete Attendance
window.deleteAttendance = async function(attendanceId) {
  const id = attendanceId || attendanceToDelete;
  if (!id) return;
  try {
    await remove(id);
    showAttendanceNotification('Attendance record deleted successfully.', 'success');
    attendanceToDelete = null;
    // Close the delete modal
    window.closeDeleteAttendanceModal?.();
    // Refresh the attendance records for current employee
    if (currentEmployeeId) {
      await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
    }
    await window.updateTodaySummaryBar();
  } catch (err) {
    showAttendanceNotification('Failed to delete attendance record: ' + err.message, 'error');
  }
};

// Example: View Attendance
window.viewEmployeeAttendance = async function(employeeId, employeeName) {
  currentEmployeeId = employeeId;
  
  // Clear any previous selection when viewing a new employee
  selectedAttendanceIds.clear();
  updateDeleteSelectedAttendanceButton();
  
  // Ensure we have a valid employee name - look up from map if not provided
  let resolvedName = employeeName;
  if (!resolvedName || resolvedName === 'undefined' || resolvedName === '') {
    const emp = employeesMap.get(employeeId);
    if (emp) {
      const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
      const suffix = emp.suffix || '';
      resolvedName = (emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ');
    } else {
      resolvedName = 'Employee';
    }
  }
  currentEmployeeName = resolvedName;
  
  // Store current employee data for printing
  window.currentViewingEmployee = employeesMap.get(employeeId) || {};
  
  const nameEl = document.getElementById('modalEmployeeName');
  const idEl = document.getElementById('modalEmployeeId');
  const modal = document.getElementById('attendanceModal');
  // Sync month/year selectors to current
  const mSel = document.getElementById('modalMonthFilter');
  const ySel = document.getElementById('modalYearFilter');
  if (mSel) mSel.value = String(currentMonth);
  if (ySel) ySel.value = String(currentYear);
  if (nameEl) nameEl.textContent = `${employeeName} - Attendance Records (${getMonthName(currentMonth)} ${currentYear})`;
  if (idEl) idEl.textContent = `Employee ID: ${employeeId || ''}`;
  if (modal) modal.style.display = 'block';
  // Load records
  console.log('[viewEmployeeAttendance] Fetching records for:', employeeId, 'month:', currentMonth, 'year:', currentYear);
  const fetched = await getAll({ employeeId });
  console.log('[viewEmployeeAttendance] Fetched records:', fetched);
  allAttendanceRecords = Array.isArray(fetched) ? fetched : [];
  console.log('[viewEmployeeAttendance] allAttendanceRecords:', allAttendanceRecords);
  const monthly = filterRecordsByMonth(allAttendanceRecords, currentMonth, currentYear);
  console.log('[viewEmployeeAttendance] Filtered monthly records:', monthly);
  renderAttendanceModal(monthly, employeeName, employeesMap.get(employeeId));
};

function renderAttendanceModal(records, employeeName, employee) {
  const tbody = document.getElementById('attendanceModalBody');
  if (!tbody) return;
  const summary = calculateMonthlySummary(records || [], employee || employeesMap.get(currentEmployeeId));
  const sumEl = document.getElementById('monthlySummary');
  if (sumEl) {
    const emp = employee || employeesMap.get(currentEmployeeId);
    const rate = calculateHourlyRate(emp);
    const otRate = rate * 1.25;
    const baseSalary = Number(emp?.baseSalary) || 0;
    const dailyRate = baseSalary / 30;
    const monthYearTitle = `${getMonthName(currentMonth)} ${currentYear} Summary`;
    // Determine employee pay type from directory fields
    const rateType = (emp?.rateType || '').toLowerCase();
    const empType = (emp?.employmentType || emp?.type || '').toLowerCase();
    // Treat Fixed/Monthly/Salary as fixed; Hourly/Time-based as time-based
    const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
    
    // Calculate expected working days for the month (Mon-Sat)
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    let expectedWorkingDays = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      // Count Mon-Sat as working days (0=Sun, 6=Sat)
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        expectedWorkingDays++;
      }
    }
    
    // Perfect attendance: no absents, no invalid, and present days >= expected working days
    const hasPerfectAttendance = summary.absentDays === 0 && summary.invalidDays === 0 && summary.presentDays >= expectedWorkingDays;
    const perfectAttendanceDisplay = hasPerfectAttendance 
      ? '<span style="color:#16a34a; font-weight:600;">Yes ✓</span>' 
      : '<span style="color:#ea580c;">No</span>';
    
    sumEl.innerHTML = `
      <div class="card" style="margin-bottom:.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:.75rem;">
          <div>
            <h4 style="margin:.2rem 0;">${monthYearTitle}</h4>
            <p class="muted" style="margin:0;">Overtime calculated at 125% of regular rate</p>
            <p class="muted" style="margin:0; font-weight:600;">Employee Type: <span style="color:#2563eb;">${isFixed ? 'Fixed' : 'Time-based'}</span></p>
            ${isFixed ? '<p class="muted" style="margin:0; color:#ea580c; font-weight:600;">Overtime pay is not applicable for fixed employees.</p>' : ''}
          </div>
          <div style="text-align:right;">
            <div class="muted">Daily Rate:</div>
            <div style="font-weight:600; color:#16a34a;">₱${dailyRate.toFixed(2)}/day</div>
            <div class="muted" style="margin-top:.3rem;">Regular Rate:</div>
            <div style="font-weight:600;">₱${rate.toFixed(2)}/hour</div>
            <div class="muted" style="margin-top:.3rem;">Overtime Rate:</div>
              <div style="font-weight:600;">${isFixed ? '<span class="muted">N/A (Fixed)</span>' : `₱${otRate.toFixed(2)}/hour (Time-based)`}</div>
          </div>
        </div>
        <div style="margin-top:.6rem; display:grid; grid-template-columns: repeat(9, 1fr); gap:.5rem;">
          <div class="summary-item"><div class="muted">Total Days</div><div class="value">${summary.totalDays}</div></div>
          <div class="summary-item"><div class="muted">Present Days</div><div class="value" style="color:#16a34a;">${summary.presentDays}</div></div>
          <div class="summary-item"><div class="muted">Absent Days</div><div class="value" style="color:#ea580c;">${summary.absentDays}</div></div>
          <div class="summary-item"><div class="muted">Overtime Days</div><div class="value">${summary.overtimeDays}</div></div>
          <div class="summary-item"><div class="muted">Total Hours</div><div class="value">${formatHoursMinutes(summary.totalHours)}</div></div>
          <div class="summary-item"><div class="muted">Total Overtime</div><div class="value">${formatHoursMinutes(summary.totalOvertime)}</div></div>
          <div class="summary-item"><div class="muted">Daily Standard</div><div class="value">${formatHoursMinutes(summary.dailyStandardHours)}</div></div>
          <div class="summary-item"><div class="muted">Total Overtime Pay</div><div class="value" style="color:#16a34a;">${isFixed ? 'N/A (Fixed)' : `₱${summary.totalOvertimePay.toFixed(2)}`}</div></div>
          <div class="summary-item"><div class="muted">Perfect Attendance</div><div class="value">${perfectAttendanceDisplay}</div></div>
        </div>
        <div style="margin-top:.6rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:.5rem; border-top:1px solid #275b48; padding-top:.5rem;">
          <div class="summary-item"><div class="muted">Vacation Days</div><div class="value" style="color:#0dcaf0;">${employee?.vacationDays || 0}</div></div>
          <div class="summary-item"><div class="muted">Sick Days</div><div class="value" style="color:#ea580c;">${employee?.sickDays || 0}</div></div>
          <div class="summary-item"><div class="muted">Personal Days</div><div class="value" style="color:#ca8a04;">${employee?.personalDays || 0}</div></div>
          <div class="summary-item"><div class="muted">Leave Used (Month)</div><div class="value">${summary.leaveUsed || 0}</div></div>
        </div>
      </div>`;
  }
  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="px-4 py-4 text-center">No attendance for ${employeeName} in ${getMonthName(currentMonth)} ${currentYear}.</td></tr>`;
    return;
  }

  // Deduplicate records by date (keep first occurrence)
  const seenDates = new Set();
  const uniqueRecords = records.filter(r => {
    const dateKey = r.date ? new Date(r.date).toISOString().slice(0,10) : '';
    if (!dateKey || seenDates.has(dateKey)) return false;
    seenDates.add(dateKey);
    return true;
  });

  // Helper to compute status
  function getStatus(r) {
    const hasAM = !!(r.timeInAM && r.timeOutAM);
    const hasPM = !!(r.timeInPM && r.timeOutPM);
    const total = Number(r.totalHoursWorked) || 0;
    const emp = employee || employeesMap.get(currentEmployeeId);
    const standard = Number(emp?.standardWorkweekHours) || 40;
    // Daily standard hours = Standard Workweek Hours / 7 days
    const daily = standard / 7;
    const tol = 0.01;
    
    // Minimum hours thresholds
    const minHoursForHalfDay = daily / 2 * 0.75; // At least 75% of half day (e.g., 3 hours for 8-hour day)
    const minHoursForValid = 0.5; // At least 30 minutes to count as valid work
    
    if (!hasAM && !hasPM) return 'Absent';
    if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
      // Only AM or PM - check if enough hours for Half Day
      if (total < minHoursForValid) {
        return 'Invalid'; // Too short to count (e.g., 5 minutes)
      } else if (total < minHoursForHalfDay) {
        return 'Undertime'; // Some work but not enough for half day
      } else {
        return 'Half Day';
      }
    }
    if (total < 0) return 'Invalid';
    if (total < (daily - tol)) return 'Undertime';
    if (total > (daily + tol)) return 'Overtime';
    return 'Present';
  }

  function getStatusColor(status) {
    switch (status) {
      case 'Present': return 'color:#16a34a;';
      case 'Overtime': return 'color:#2563eb;';
      case 'Undertime': return 'color:#ea580c;';
      case 'Half Day': return 'color:#ca8a04;';
      case 'Absent': return 'color:#dc2626;';
      case 'Invalid': return 'color:#9333ea;'; // Purple for invalid/too short
      default: return '';
    }
  }

  // Define isFixed once for all rows
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  
  // Calculate hourly rate for Regular Pay column
  const hourlyRate = calculateHourlyRate(employee);
  
  // Calculate daily rate for fixed employees
  const baseSalaryForRate = Number(employee?.baseSalary) || 0;
  const fixedDailyRate = baseSalaryForRate / 30;

  const rows = uniqueRecords
    .slice()
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .map(r => {
      const id = r.id || r._airtableId || '';
      // Time In column: show times stacked (one per line)
      const timeInParts = [];
      if (r.timeInAM) timeInParts.push(formatTime(r.timeInAM));
      if (r.timeInPM) timeInParts.push(formatTime(r.timeInPM));
      const timeIn = timeInParts.length ? timeInParts.join('<br>') : '-';

      // Time Out column: show times stacked (one per line)
      const timeOutParts = [];
      if (r.timeOutAM) timeOutParts.push(formatTime(r.timeOutAM));
      if (r.timeOutPM) timeOutParts.push(formatTime(r.timeOutPM));
      const timeOut = timeOutParts.length ? timeOutParts.join('<br>') : '-';

      const totalVal = Number(r.totalHoursWorked) || 0;
      const total = formatHoursMinutes(totalVal);
      
      // Get daily standard hours for the employee
      const empStandardWeeklyHours = Number(employee?.standardWorkweekHours) || 40;
      const empDailyStandardHours = empStandardWeeklyHours / 7;
      
      // Calculate Regular Pay for this day
      // For Fixed employees: full daily rate unless Absent (₱0) or Half Day (half rate)
      // Late, Undertime, Overtime don't affect the rate for Fixed employees
      // For Time-based employees: 
      //   - Regular Pay = min(total hours, daily standard hours) × hourly rate
      //   - Overtime is calculated separately
      let regularPay = 0;
      const hasAM = !!(r.timeInAM && r.timeOutAM);
      const hasPM = !!(r.timeInPM && r.timeOutPM);
      const isAbsent = !hasAM && !hasPM;
      const isHalfDay = (hasAM && !hasPM) || (!hasAM && hasPM);
      
      if (isFixed) {
        // Fixed employee: full daily rate, half for half day, 0 for absent
        if (isAbsent) {
          regularPay = 0;
        } else if (isHalfDay) {
          regularPay = fixedDailyRate / 2;
        } else {
          regularPay = fixedDailyRate; // Full daily rate regardless of late/undertime/overtime
        }
      } else {
        // Time-based employee: pay based on hours worked (capped at daily standard for regular pay)
        // Regular hours = min(total hours, daily standard hours)
        const regularHours = Math.min(totalVal, empDailyStandardHours);
        regularPay = regularHours * hourlyRate;
      }
      
      // Calculate overtime for time-based employees
      const overtimeHoursNum = Number(r.overtimeHours) || 0;
      // For time-based, calculate OT pay: OT hours × hourly rate × 1.25
      const calculatedOTPay = isFixed ? 0 : (overtimeHoursNum * hourlyRate * 1.25);
      
      const ot = isFixed ? 'N/A' : (overtimeHoursNum > 0 ? `+${formatHoursMinutes(overtimeHoursNum)}` : '-');
      const leaveType = r.leaveType || '';
      const isOnLeave = leaveType && leaveType !== 'None' && leaveType !== '';
      const status = isOnLeave ? 'On Leave' : getStatus(r);
      const statusStyle = isOnLeave ? 'color:#0dcaf0;' : getStatusColor(status);
      
      // Leave Type display with color coding
      let leaveDisplay = '-';
      if (leaveType === 'Personal') leaveDisplay = '<span style="color:#ca8a04;">Personal</span>';
      else if (leaveType === 'Sick') leaveDisplay = '<span style="color:#ea580c;">Sick</span>';
      else if (leaveType === 'Vacation') leaveDisplay = '<span style="color:#0dcaf0;">Vacation</span>';
      
      const isChecked = selectedAttendanceIds.has(id) ? 'checked' : '';
      
      return `
        <tr data-record-id="${id}" data-overtime-hours="${Number(r.overtimeHours)||0}">
          <td style="text-align:center;">
            <input type="checkbox" class="attendance-checkbox" data-id="${id}" data-date="${r.date}" ${isChecked} 
                   onchange="window.toggleAttendanceSelection?.('${id}', this.checked)" 
                   style="cursor:pointer; width:18px; height:18px;" />
          </td>
          <td class="px-4 py-2">${formatDate(r.date)}</td>
          <td class="px-3 py-2">${timeIn}</td>
          <td class="px-3 py-2">${timeOut}</td>
          <td class="px-3 py-2">${total}</td>
          <td class="px-3 py-2" style="color:#28a745; font-weight:500;">₱${regularPay.toFixed(2)}</td>
          <td class="px-3 py-2">${ot}</td>
          <td class="px-3 py-2 overtime-pay-cell">${isFixed ? 'N/A' : (calculatedOTPay > 0 ? `₱${calculatedOTPay.toFixed(2)}` : '-')}</td>
          <td class="px-3 py-2">${r.isDoublePay ? '<span style="color:#d97706;font-weight:600;">Yes</span>' : '<span style="color:#64748b;">No</span>'}</td>
          <td class="px-3 py-2">${leaveDisplay}</td>
          <td class="px-3 py-2" style="${statusStyle}font-weight:600;">${status}</td>
          <td class="px-3 py-2">${r.remarks || '-'}</td>
          <td class="px-3 py-2" style="text-align:center;">
            <div class="actions-inline">
              <button class="actions-btn" onclick="window.openEditAttendance('${id}')">Edit</button>
              <button class="actions-btn delete-btn" onclick="window.promptDeleteAttendance('${id}', '${formatDate(r.date)}')">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  tbody.innerHTML = rows;
  updateSelectAllAttendanceCheckbox();
}

window.applyModalMonthFilter = function() {
  const monthSel = document.getElementById('modalMonthFilter');
  const yearSel = document.getElementById('modalYearFilter');
  currentMonth = monthSel ? parseInt(monthSel.value,10) : currentMonth;
  currentYear = yearSel ? parseInt(yearSel.value,10) : currentYear;
  // Clear selection when changing month/year filter
  selectedAttendanceIds.clear();
  updateDeleteSelectedAttendanceButton();
  const monthly = filterRecordsByMonth(allAttendanceRecords, currentMonth, currentYear);
  renderAttendanceModal(monthly, currentEmployeeName, employeesMap.get(currentEmployeeId));
};

window.exportMonthlyReport = function() {
  if (!currentEmployeeId) { showAttendanceNotification('Select an employee first.', 'warning'); return; }
  const mSel = document.getElementById('modalMonthFilter');
  const ySel = document.getElementById('modalYearFilter');
  const month = mSel ? parseInt(mSel.value,10) : currentMonth;
  const year = ySel ? parseInt(ySel.value,10) : currentYear;
  const monthly = filterRecordsByMonth(allAttendanceRecords, month, year);
  const emp = employeesMap.get(currentEmployeeId);
  const hr = calculateHourlyRate(emp || {});
  const otRate = hr * 1.25;

  const rows = monthly.map(r => ({
    EmployeeId: r.employeeId || currentEmployeeId,
    Date: (new Date(r.date)).toISOString().slice(0,10),
    TimeInAM: r.timeInAM || '',
    TimeOutAM: r.timeOutAM || '',
    TimeInPM: r.timeInPM || '',
    TimeOutPM: r.timeOutPM || '',
    TotalHours: (Number(r.totalHoursWorked)||0).toFixed(2),
    OvertimeHours: (Number(r.overtimeHours)||0).toFixed(2),
    OvertimePay: (String(emp?.rateType).toLowerCase() !== 'fixed' && Number(r.overtimeHours)>0)
      ? (otRate * Number(r.overtimeHours)).toFixed(2) : '',
    Status: (function(){
      const total = Number(r.totalHoursWorked)||0;
      const standard = Number(emp?.standardWorkweekHours)||40;
      const daily = standard/7; const tol=0.01;
      const hasAM = r.timeInAM && r.timeOutAM; const hasPM = r.timeInPM && r.timeOutPM;
      // Minimum hours thresholds (same as getStatus function)
      const minHoursForHalfDay = daily / 2 * 0.75; // At least 75% of half day
      const minHoursForValid = 0.5; // At least 30 minutes to count as valid work
      
      if (!hasAM && !hasPM) return 'Absent';
      if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
        // Only AM or PM - check if enough hours for Half Day
        if (total < minHoursForValid) return 'Invalid'; // Too short (e.g., 5 minutes)
        if (total < minHoursForHalfDay) return 'Short Hours';
        return 'Half Day';
      }
      if (total < (daily - tol)) return 'Short Hours';
      if (total > (daily + tol)) return 'Overtime';
      return 'Present';
    })(),
    Remarks: r.remarks || ''
  }));

  const headers = Object.keys(rows[0] || {EmployeeId:'',Date:'',TimeInAM:'',TimeOutAM:'',TimeInPM:'',TimeOutPM:'',TotalHours:'',OvertimeHours:'',OvertimePay:'',Status:'',Remarks:''});
  const csv = [headers.join(','), ...rows.map(row => headers.map(h => String(row[h]).replace(/\r?\n/g,' ').replace(/,/g,';')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${currentEmployeeId}_${year}_${String(month).padStart(2,'0')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Modal helpers (Tailwind style)
window.closeAttendanceModal = function() {
  const modal = document.getElementById('attendanceModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
  }
};

// Print Attendance Records
window.printAttendanceRecords = function() {
  const employeeName = document.getElementById('modalEmployeeName')?.textContent || 'Employee';
  const employeeId = document.getElementById('modalEmployeeId')?.textContent?.replace('Employee ID:', '').trim() || '';
  const month = document.getElementById('modalMonthFilter')?.value || new Date().getMonth() + 1;
  const year = document.getElementById('modalYearFilter')?.value || new Date().getFullYear();
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month) - 1] || '';
  
  // Populate signature section with employee info
  const printEmployeeNameEl = document.getElementById('printAttendanceEmployeeName');
  const printEmployeeIdEl = document.getElementById('printAttendanceEmployeeId');
  const printEmployeeDeptEl = document.getElementById('printAttendanceEmployeeDept');
  
  if (printEmployeeNameEl) printEmployeeNameEl.textContent = employeeName;
  if (printEmployeeIdEl) printEmployeeIdEl.textContent = employeeId;
  if (printEmployeeDeptEl) {
    const currentEmployee = window.currentViewingEmployee || {};
    printEmployeeDeptEl.textContent = currentEmployee.Department || currentEmployee.department || 'Department';
  }
  
  // Completely remove payroll print styles from DOM to prevent any conflicts
  const payrollPrintStyles = document.getElementById('payrollPrintStyles');
  let payrollPrintStylesParent = null;
  let payrollPrintStylesNextSibling = null;
  if (payrollPrintStyles) {
    payrollPrintStylesParent = payrollPrintStyles.parentNode;
    payrollPrintStylesNextSibling = payrollPrintStyles.nextSibling;
    payrollPrintStyles.remove();
  }
  
  // Clear any leftover print classes from previous print attempts
  document.body.classList.remove('printing-attendance');
  document.body.classList.remove('printing-payroll');
  
  // Add printing class to body to activate conditional print styles
  document.body.classList.add('printing-attendance');
  
  const originalTitle = document.title;
  document.title = ' ';
  
  window.print();
  
  setTimeout(() => {
    document.title = originalTitle;
    document.body.classList.remove('printing-attendance');
    // Re-add payroll print styles to DOM
    if (payrollPrintStyles && payrollPrintStylesParent) {
      if (payrollPrintStylesNextSibling) {
        payrollPrintStylesParent.insertBefore(payrollPrintStyles, payrollPrintStylesNextSibling);
      } else {
        payrollPrintStylesParent.appendChild(payrollPrintStyles);
      }
    }
  }, 1000);
};

window.closeEditAttendanceModal = function() {
  const modal = document.getElementById('editAttendanceModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
  }
  // Always reset the save button when modal is closed
  resetEditAttendanceButton();
};

// Remove Tailwind-specific close for Add modal; use hideAddAttendanceModal instead
// (kept for backward compatibility if referenced elsewhere)
window.closeAddAttendanceModal = function() {
  const modal = document.getElementById('addAttendanceModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
  }
};

window.closeDeleteAttendanceModal = function() {
  const modal = document.getElementById('deleteAttendanceModal');
  if (modal) modal.style.display = 'none';
};

// Do not overwrite the initial showAddAttendanceModal defined at top

// Filters on main attendance list
window.applyAttendanceFilters = function() {
  const name = (document.getElementById('attendanceNameFilter')?.value || '').toLowerCase();
  const dep = document.getElementById('attendanceDepartmentFilter')?.value || '';
  const status = document.getElementById('attendanceStatusFilter')?.value || '';
  const location = document.getElementById('attendanceLocationFilter')?.value || '';

  // Filter employees array
  filteredAttendanceEmployees = employees.filter(emp => {
    const middleInitial = emp.middleName ? `${emp.middleName.charAt(0)}.` : '';
    const suffix = emp.suffix || '';
    const fullName = ((emp.lastName || '') + (emp.firstName || middleInitial || suffix ? ', ' : '') + [emp.firstName || '', middleInitial, suffix].filter(n => n).join(' ')).toLowerCase();
    const department = emp.department || '';
    const locationType = emp.locationType || '';
    
    // Get today's attendance status for this employee
    const attendanceStatus = getTodayAttendanceStatus(emp);
    
    // Match name filter
    if (name && !fullName.includes(name)) return false;
    
    // Match department filter
    if (dep && department !== dep) return false;
    
    // Match location filter
    if (location && locationType !== location) return false;
    
    // Match attendance status filter
    if (status) {
      // The status filter value matches the label from getTodayAttendanceStatus
      // e.g., "Present", "Absent", "Half Day", "Undertime", "On Leave", "No Record"
      if (!attendanceStatus.label.includes(status)) return false;
    }
    
    return true;
  });

  // Reset to page 1 and re-render
  attendanceCurrentPage = 1;
  renderAttendanceEmployeesPage();
  
  const sum = document.getElementById('attendanceFilterSummary');
  if (sum) sum.textContent = `Showing ${filteredAttendanceEmployees.length} employee(s)`;
};

// Optional stubs for toolbar buttons
window.markAttendance = function() { showAttendanceNotification('Mark Attendance action', 'info'); };
window.generateAttendanceReport = function() { showAttendanceNotification('Generate Attendance Report - Coming Soon', 'info'); };
window.exportAttendanceData = function() { showAttendanceNotification('Export Attendance Data - Coming Soon', 'info'); };

// Edit/Delete helpers wired from modal actions
window.openEditAttendance = async function(id) {
  if (!id) return;
  const rec = await getById(id);
  if (!rec) return;
  const modal = document.getElementById('editAttendanceModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
  
  // Re-attach form submit handler FIRST - before setting values
  // Clone and replace to remove all existing listeners
  const form = document.getElementById('editAttendanceForm');
  if (form) {
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    newForm.addEventListener('submit', handleEditAttendanceSubmit);
  }
  
  // Now set all the values on the new form elements
  document.getElementById('editAttendanceId').value = id;
  document.getElementById('editEmployeeId').value = rec.employeeId || currentEmployeeId || '';
  document.getElementById('editEmployeeName').textContent = currentEmployeeName || '';
  const editDisplayIdEl = document.getElementById('editEmployeeDisplayId');
  if (editDisplayIdEl) editDisplayIdEl.textContent = rec.employeeId ? `(ID: ${rec.employeeId})` : (currentEmployeeId ? `(ID: ${currentEmployeeId})` : '');
  document.getElementById('editDate').value = rec.date || '';
  document.getElementById('editTimeInAM').value = rec.timeInAM || '';
  document.getElementById('editTimeOutAM').value = rec.timeOutAM || '';
  document.getElementById('editTimeInPM').value = rec.timeInPM || '';
  document.getElementById('editTimeOutPM').value = rec.timeOutPM || '';
  document.getElementById('editRemarks').value = rec.remarks || '';
  
  // Set leave type dropdown
  const leaveTypeSelect = document.getElementById('editLeaveType');
  if (leaveTypeSelect) {
    // Normalize leave type value - empty or 'None' should select 'None'
    const leaveValue = (rec.leaveType && rec.leaveType !== '' && rec.leaveType !== 'None') ? rec.leaveType : 'None';
    console.log('[Edit Attendance] Setting leave type:', { recordLeaveType: rec.leaveType, settingTo: leaveValue });
    leaveTypeSelect.value = leaveValue;
  }
  
  const chk = document.getElementById('editIsDoublePay');
  if (chk) chk.checked = !!rec.isDoublePay;
  
  // Disable double pay checkbox for fixed rate employees
  const employee = employeesMap.get(rec.employeeId || currentEmployeeId);
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const editDoublePayChk = document.getElementById('editIsDoublePay');
  const editDoublePayLabel = editDoublePayChk?.parentElement;
  if (editDoublePayChk) {
    editDoublePayChk.disabled = isFixed;
    if (isFixed) {
      editDoublePayChk.checked = false; // Force uncheck for fixed employees
    }
    if (isFixed && editDoublePayLabel) {
      editDoublePayLabel.innerHTML = '<input type="checkbox" id="editIsDoublePay" name="isDoublePay" disabled /><label for="editIsDoublePay" style="margin:0; color:#888;">Double Pay (Not applicable for Fixed Rate)</label>';
    } else if (editDoublePayLabel) {
      editDoublePayLabel.innerHTML = `<input type="checkbox" id="editIsDoublePay" name="isDoublePay" ${rec.isDoublePay ? 'checked' : ''} /><label for="editIsDoublePay" style="margin:0;">Double Pay (Sunday/Holiday)</label>`;
    }
  }
  
  // Populate summary values
  const totalHoursEl = document.getElementById('editTotalHours');
  const overtimeHoursEl = document.getElementById('editOvertimeHours');
  const overtimePayEl = document.getElementById('editOvertimePay');
  
  if (totalHoursEl) {
    totalHoursEl.textContent = formatHoursMinutes(parseFloat(rec.totalHoursWorked));
  }
  if (overtimeHoursEl) {
    overtimeHoursEl.textContent = formatHoursMinutes(parseFloat(rec.overtimeHours));
  }
  if (overtimePayEl) {
    overtimePayEl.textContent = rec.overTimePay != null ? '₱' + parseFloat(rec.overTimePay).toFixed(2) : '-';
  }
};

window.promptDeleteAttendance = function(id, dateStr) {
  const modal = document.getElementById('deleteAttendanceModal');
  if (modal) modal.style.display = 'block';
  const span = document.getElementById('deleteDate');
  if (span) span.textContent = dateStr || '';
  // Store to delete
  attendanceToDelete = id;
};

// Show/Hide Duplicate Attendance Modal
window.showDuplicateAttendanceModal = function() {
  let modal = document.getElementById('duplicateAttendanceModal');
  if (!modal) {
    // Dynamically create modal if missing
    modal = document.createElement('div');
    modal.id = 'duplicateAttendanceModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" style="max-width:400px; z-index:1000;">
        <span class="close" onclick="window.closeDuplicateAttendanceModal?.()">&times;</span>
        <div class="modal-header">
          <h3 style="margin:0; color:#d9534f;">Duplicate Attendance</h3>
        </div>
        <div class="modal-body">
          <p>An attendance record already exists for this employee and date.</p>
          <p class="muted" style="margin-top:.5rem;">Please edit or delete the existing record if you need to make changes.</p>
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:0.5rem;">
          <button class="actions-btn" onclick="window.closeDuplicateAttendanceModal?.()">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  console.log('[Modal] showDuplicateAttendanceModal called', modal);
  modal.style.display = 'block';
  modal.focus && modal.focus();
};
window.closeDuplicateAttendanceModal = function() {
  const modal = document.getElementById('duplicateAttendanceModal');
  if (modal) modal.style.display = 'none';
};

// Hook delete modal to existing remove()
window.deleteAttendance = async function() {
  console.log('Delete called, attendanceToDelete:', attendanceToDelete);
  if (!attendanceToDelete) {
    showAttendanceNotification('No attendance record selected for deletion.', 'warning');
    return;
  }
  
  // Get delete button and change text
  const deleteModal = document.getElementById('deleteAttendanceModal');
  const deleteBtn = deleteModal?.querySelector('button.delete-btn, button[onclick*="deleteAttendance"]');
  const originalText = deleteBtn?.textContent || 'Delete';
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
  }
  
  try {
    // Get the record first to check if it has leave type
    const recordToDelete = await getById(attendanceToDelete);
    const leaveType = recordToDelete?.leaveType || 'None';
    const employeeId = recordToDelete?.employeeId;
    
    const result = await remove(attendanceToDelete);
    console.log('Delete result:', result);
    
    // Refund leave if the record had a leave type
    if (leaveType && leaveType !== 'None' && employeeId) {
      try {
        const employee = employeesMap.get(employeeId);
        if (employee) {
          const hrApiUpdate = window.hrApiUpdate;
          const updateData = {};
          
          if (leaveType === 'Vacation') {
            updateData.vacationDays = (employee.vacationDays || 0) + 1;
          } else if (leaveType === 'Sick') {
            updateData.sickDays = (employee.sickDays || 0) + 1;
          } else if (leaveType === 'Personal') {
            updateData.personalDays = (employee.personalDays || 0) + 1;
          }
          
          if (Object.keys(updateData).length > 0) {
            await hrApiUpdate(employee.id, updateData);
            console.log('[Attendance] Refunded leave to employee:', updateData);
          }
        }
      } catch (err) {
        console.error('[Attendance] Failed to refund leave:', err);
      }
    }
    
    attendanceToDelete = null;
    window.closeDeleteAttendanceModal();
    showAttendanceNotification('Attendance record deleted successfully.', 'success');
    // Refresh modal table
    await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
    await window.updateTodaySummaryBar();
  } catch (err) {
    console.error('Delete error:', err);
    showAttendanceNotification('Failed to delete attendance record: ' + err.message, 'error');
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = originalText;
    }
  }
};

function calculateAddAttendanceSummary() {
  const timeInAM = document.getElementById('addTimeInAM').value;
  const timeOutAM = document.getElementById('addTimeOutAM').value;
  const timeInPM = document.getElementById('addTimeInPM').value;
  const timeOutPM = document.getElementById('addTimeOutPM').value;
  const remarks = document.getElementById('addRemarks').value || '';
  const isDoublePay = document.getElementById('addIsDoublePay').checked;
  let totalMinutes = 0;
  if (timeInAM && timeOutAM) {
    const [inHour, inMinute] = timeInAM.split(':').map(Number);
    const [outHour, outMinute] = timeOutAM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  if (timeInPM && timeOutPM) {
    const [inHour, inMinute] = timeInPM.split(':').map(Number);
    const [outHour, outMinute] = timeOutPM.split(':').map(Number);
    totalMinutes += (outHour * 60 + outMinute) - (inHour * 60 + inMinute);
  }
  
  const hasAM = !!(timeInAM && timeOutAM);
  const hasPM = !!(timeInPM && timeOutPM);
  
  // Use current employee for rate
  const employee = employeesMap.get(currentEmployeeId);
  const standardWorkweekHours = employee?.standardWorkweekHours || 40;
  const dailyStandardHours = standardWorkweekHours / 7;
  
  // Calculate actual work hours first
  let actualWorkHours = totalMinutes / 60;
  
  // Get schedule span from coreWorkingHours (e.g., "8:00 AM - 6:00 PM" = 10 hours)
  const scheduleSpan = getScheduleSpanHours(employee?.coreWorkingHours);
  
  // Add 1-hour lunch break only if:
  // 1. Both AM and PM shifts are worked
  // 2. Schedule span exists and is >= daily standard (indicates lunch may be included in span)
  // 3. Actual work hours < daily standard hours (need to add lunch to reach standard)
  if (hasAM && hasPM && scheduleSpan && scheduleSpan >= dailyStandardHours && actualWorkHours < dailyStandardHours) {
    totalMinutes += 60;
  }
  
  let totalHoursWorked = totalMinutes / 60;
  // Determine if Fixed rate type
  const rateType = (employee?.rateType || '').toLowerCase();
  const empType = (employee?.employmentType || employee?.type || '').toLowerCase();
  const isFixed = rateType.includes('fixed') || rateType.includes('monthly') || rateType.includes('salary') || empType.includes('fixed');
  const overtimeHours = isFixed ? 0 : Math.max(0, totalHoursWorked - dailyStandardHours);
  const baseSalary = employee?.baseSalary || 0;
  const hourlyRate = (baseSalary && dailyStandardHours > 0) ? (baseSalary / 30) / dailyStandardHours : 0;
  const overtimeRate = hourlyRate * 1.25;
  const overTimePay = (!isFixed && overtimeHours > 0) ? overtimeHours * overtimeRate : 0;
  document.getElementById('addTotalHours').textContent = formatHoursMinutes(totalHoursWorked);
  document.getElementById('addOvertimeHours').textContent = formatHoursMinutes(overtimeHours);
  document.getElementById('addOvertimePay').textContent = overTimePay > 0 ? `₱${overTimePay.toFixed(2)}` : '-';
}

function bindAddAttendanceLiveSummary() {
  const ids = ['addTimeInAM','addTimeOutAM','addTimeInPM','addTimeOutPM','addRemarks','addIsDoublePay'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateAddAttendanceSummary);
    if (el && el.type === 'checkbox') el.addEventListener('change', calculateAddAttendanceSummary);
  });
}

// Patch showAddAttendanceModal to bind live summary
const _showAddAttendanceModal = window.showAddAttendanceModal;
window.showAddAttendanceModal = async function() {
  if (typeof _showAddAttendanceModal === 'function') await _showAddAttendanceModal();
  bindAddAttendanceLiveSummary();
  calculateAddAttendanceSummary();
};

window.updateTodaySummaryBar = updateTodaySummaryBar;

// ============================================
// MULTI-SELECT DELETE ATTENDANCE FUNCTIONS
// ============================================

// Toggle individual attendance record selection
function toggleAttendanceSelection(attendanceId, isChecked) {
  console.log('toggleAttendanceSelection called:', attendanceId, 'isChecked:', isChecked);
  
  if (isChecked === undefined) {
    // Toggle mode - used when called without parameter
    if (selectedAttendanceIds.has(attendanceId)) {
      selectedAttendanceIds.delete(attendanceId);
    } else {
      selectedAttendanceIds.add(attendanceId);
    }
  } else if (isChecked) {
    selectedAttendanceIds.add(attendanceId);
  } else {
    selectedAttendanceIds.delete(attendanceId);
  }
  
  console.log('selectedAttendanceIds now has', selectedAttendanceIds.size, 'items:', Array.from(selectedAttendanceIds));
  
  updateDeleteSelectedAttendanceButton();
  updateSelectAllAttendanceCheckbox();
}

// Toggle select all attendance records
function toggleSelectAllAttendance() {
  const selectAllCheckbox = document.getElementById('selectAllAttendance');
  const checkboxes = document.querySelectorAll('.attendance-checkbox');
  
  if (selectAllCheckbox?.checked) {
    // Select all
    checkboxes.forEach(cb => {
      const id = cb.dataset.id;
      if (id) {
        selectedAttendanceIds.add(id);
        cb.checked = true;
      }
    });
  } else {
    // Deselect all
    checkboxes.forEach(cb => {
      const id = cb.dataset.id;
      if (id) {
        selectedAttendanceIds.delete(id);
        cb.checked = false;
      }
    });
  }
  updateDeleteSelectedAttendanceButton();
}

// Update the "Select All" checkbox state
function updateSelectAllAttendanceCheckbox() {
  const selectAllCheckbox = document.getElementById('selectAllAttendance');
  const checkboxes = document.querySelectorAll('.attendance-checkbox');
  
  if (!selectAllCheckbox || checkboxes.length === 0) return;
  
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  
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
function updateDeleteSelectedAttendanceButton() {
  const deleteBtn = document.getElementById('deleteSelectedAttendanceBtn');
  const countSpan = document.getElementById('selectedAttendanceCount');
  
  if (deleteBtn && countSpan) {
    const count = selectedAttendanceIds.size;
    countSpan.textContent = count;
    deleteBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// Show bulk delete attendance modal
function showBulkDeleteAttendanceModal() {
  console.log('showBulkDeleteAttendanceModal called, selectedAttendanceIds size:', selectedAttendanceIds.size);
  console.log('Selected IDs:', Array.from(selectedAttendanceIds));
  
  if (selectedAttendanceIds.size === 0) {
    showAttendanceNotification('Please select at least one attendance record to delete.', 'warning');
    return;
  }
  
  const modal = document.getElementById('bulkDeleteAttendanceModal');
  const countEl = document.getElementById('bulkAttendanceDeleteCount');
  const listEl = document.getElementById('bulkAttendanceDeleteList');
  
  console.log('Modal element found:', !!modal);
  
  if (!modal) {
    console.error('bulkDeleteAttendanceModal not found in DOM');
    return;
  }
  
  // Update count
  if (countEl) countEl.textContent = selectedAttendanceIds.size;
  
  // Build list of selected records
  if (listEl) {
    const checkboxes = document.querySelectorAll('.attendance-checkbox:checked');
    let listHtml = '';
    checkboxes.forEach(cb => {
      const dateStr = cb.dataset.date ? formatDate(cb.dataset.date) : 'Unknown Date';
      listHtml += `<div style="padding:0.25rem 0; border-bottom:1px solid #1a2e24;">
        <span style="color:#8ab4a0;">📅</span> ${dateStr}
      </div>`;
    });
    listEl.innerHTML = listHtml || '<div style="color:#888;">No records selected</div>';
  }
  
  modal.style.display = 'block';
}

// Hide bulk delete attendance modal
function hideBulkDeleteAttendanceModal() {
  const modal = document.getElementById('bulkDeleteAttendanceModal');
  if (modal) modal.style.display = 'none';
  // Reset the modal state
  const confirmSection = document.getElementById('bulkDeleteConfirmSection');
  const progressSection = document.getElementById('bulkDeleteProgressSection');
  const btn = document.getElementById('confirmBulkDeleteAttendanceBtn');
  const cancelBtn = document.getElementById('bulkDeleteCancelBtn');
  const closeBtn = document.getElementById('bulkDeleteCloseBtn');
  if (confirmSection) confirmSection.style.display = 'block';
  if (progressSection) progressSection.style.display = 'none';
  if (btn) { btn.style.display = ''; btn.disabled = false; }
  if (cancelBtn) cancelBtn.disabled = false;
  if (closeBtn) closeBtn.style.display = '';
  bulkDeleteCancelled = false;
}

// Cancellation flag for bulk delete
let bulkDeleteCancelled = false;

// Cancel bulk delete operation
window.cancelBulkDeleteAttendance = function() {
  const progressSection = document.getElementById('bulkDeleteProgressSection');
  // If operation is in progress, set cancel flag
  if (progressSection && progressSection.style.display === 'block') {
    bulkDeleteCancelled = true;
    showAttendanceNotification('Cancelling delete operation...', 'info');
  } else {
    // Just close the modal if not in progress
    hideBulkDeleteAttendanceModal();
  }
};

// Confirm and execute bulk delete for attendance
async function confirmBulkDeleteAttendance() {
  if (selectedAttendanceIds.size === 0) {
    showAttendanceNotification('No records selected to delete.', 'warning');
    return;
  }
  
  // Reset cancel flag
  bulkDeleteCancelled = false;
  
  const btn = document.getElementById('confirmBulkDeleteAttendanceBtn');
  const cancelBtn = document.getElementById('bulkDeleteCancelBtn');
  const closeBtn = document.getElementById('bulkDeleteCloseBtn');
  const confirmSection = document.getElementById('bulkDeleteConfirmSection');
  const progressSection = document.getElementById('bulkDeleteProgressSection');
  const progressBar = document.getElementById('bulkDeleteProgressBar');
  const progressText = document.getElementById('bulkDeleteProgressText');
  const currentItem = document.getElementById('bulkDeleteCurrentItem');
  
  const originalText = btn?.textContent || 'Delete All Selected';
  
  try {
    // Hide confirm section, show progress section
    if (confirmSection) confirmSection.style.display = 'none';
    if (progressSection) progressSection.style.display = 'block';
    
    // Disable buttons during deletion
    if (btn) {
      btn.disabled = true;
      btn.style.display = 'none';
    }
    // Keep cancel button enabled during deletion so user can cancel
    if (closeBtn) closeBtn.style.display = 'none';
    
    // Get all selected IDs with their dates for display
    const checkboxes = document.querySelectorAll('.attendance-checkbox:checked');
    const recordsToDelete = Array.from(checkboxes).map(cb => ({
      id: cb.dataset.id,
      date: cb.dataset.date ? formatDate(cb.dataset.date) : 'Unknown Date'
    }));
    
    const total = recordsToDelete.length;
    let successCount = 0;
    let failCount = 0;
    
    // Delete records one by one with progress updates
    for (let i = 0; i < recordsToDelete.length; i++) {
      // Check for cancellation
      if (bulkDeleteCancelled) {
        if (currentItem) currentItem.innerHTML = `<span style="color:#f59e0b;">⚠️ Cancelled after ${successCount} deletions</span>`;
        break;
      }
      
      const record = recordsToDelete[i];
      const progress = ((i + 1) / total) * 100;
      
      // Update progress UI
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (progressText) progressText.textContent = `${i + 1} / ${total}`;
      if (currentItem) currentItem.innerHTML = `<span style="color:#f59e0b;">🗑️ Deleting:</span> ${record.date}`;
      
      try {
        const result = await remove(record.id);
        if (result) {
          successCount++;
          if (currentItem) currentItem.innerHTML = `<span style="color:#16a34a;">✓</span> Deleted: ${record.date}`;
        } else {
          failCount++;
          if (currentItem) currentItem.innerHTML = `<span style="color:#dc2626;">✗</span> Failed: ${record.date}`;
        }
      } catch (err) {
        console.error(`Failed to delete attendance ${record.id}:`, err);
        failCount++;
        if (currentItem) currentItem.innerHTML = `<span style="color:#dc2626;">✗</span> Failed: ${record.date}`;
      }
      
      // Small delay to show progress visually
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Show completion
    const wasCancelled = bulkDeleteCancelled;
    
    if (!wasCancelled) {
      if (progressBar) progressBar.style.width = '100%';
      if (currentItem) {
        if (failCount === 0) {
          currentItem.innerHTML = `<span style="color:#16a34a;">✓ All ${successCount} records deleted successfully!</span>`;
        } else {
          currentItem.innerHTML = `<span style="color:#f59e0b;">⚠️ Deleted ${successCount}, Failed ${failCount}</span>`;
        }
      }
    }
    
    // Wait a moment to show completion
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Clear selection
    selectedAttendanceIds.clear();
    updateDeleteSelectedAttendanceButton();
    
    // Hide modal
    hideBulkDeleteAttendanceModal();
    
    // Reset modal state for next use
    if (confirmSection) confirmSection.style.display = 'block';
    if (progressSection) progressSection.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.disabled = false;
      btn.textContent = originalText;
    }
    if (cancelBtn) cancelBtn.disabled = false;
    if (closeBtn) closeBtn.style.display = 'block';
    
    // Reset cancel flag
    bulkDeleteCancelled = false;
    
    // Show result notification
    if (wasCancelled) {
      showAttendanceNotification(`Delete cancelled. ${successCount} record(s) were deleted before cancellation.`, 'warning');
    } else if (failCount === 0) {
      showAttendanceNotification(`Successfully deleted ${successCount} attendance record(s).`, 'success');
    } else {
      showAttendanceNotification(`Deleted ${successCount} record(s). Failed to delete ${failCount}.`, 'warning');
    }
    
    // Refresh the attendance view for current employee
    if (currentEmployeeId) {
      await window.viewEmployeeAttendance(currentEmployeeId, currentEmployeeName);
    }
    
    // Update summary bar
    await window.updateTodaySummaryBar?.();
    
  } catch (err) {
    console.error('Bulk delete attendance error:', err);
    showAttendanceNotification('An error occurred during bulk delete: ' + err.message, 'error');
    
    // Reset modal state on error
    if (confirmSection) confirmSection.style.display = 'block';
    if (progressSection) progressSection.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.disabled = false;
      btn.textContent = originalText;
    }
    if (cancelBtn) cancelBtn.disabled = false;
    if (closeBtn) closeBtn.style.display = 'block';
  }
}

// Clear attendance selection when opening a different employee's records
function clearAttendanceSelection() {
  selectedAttendanceIds.clear();
  updateDeleteSelectedAttendanceButton();
  const selectAllCheckbox = document.getElementById('selectAllAttendance');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  }
}

// Expose multi-select functions globally
window.toggleAttendanceSelection = toggleAttendanceSelection;
window.toggleSelectAllAttendance = toggleSelectAllAttendance;
window.showBulkDeleteAttendanceModal = showBulkDeleteAttendanceModal;
window.hideBulkDeleteAttendanceModal = hideBulkDeleteAttendanceModal;
window.confirmBulkDeleteAttendance = confirmBulkDeleteAttendance;
