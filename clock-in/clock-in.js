/**
 * clock-in.js
 * 
 * Clock In Module for Morph Sagrado Ventures Inc.
 * 
 * Features:
 * - 4 clock buttons: Morning In, Morning Out, Afternoon In, Afternoon Out
 * - Employee search with autocomplete (supports barcode scanner)
 * - Real-time clock display
 * - Employee attendance search by Name or ID
 * - Attendance history view
 * - Save to Airtable Attendances table
 */

(function() {
  'use strict';

  // Module state
  let allEmployees = [];
  let selectedEmployee = null;
  let currentClockAction = null;
  let clockInterval = null;
  let todayAttendance = [];
  let searchedEmployee = null;
  let searchedAttendance = [];
  let isSaving = false; // Prevent multiple saves

  /**
   * Initialize the Clock In module
   */
  async function init() {
    console.log('[Clock In] Initializing module...');
    
    try {
      // Load employees for autocomplete
      await loadEmployees();
      
      // Set up event listeners
      setupEventListeners();
      
      // Start the live clock
      startLiveClock();
      
      // Load today's attendance
      await loadTodayAttendance();
      
      // Set default date filters
      setDefaultDateFilters();
      
      console.log('[Clock In] Module initialized successfully');
    } catch (error) {
      console.error('[Clock In] Initialization error:', error);
      showNotification('Failed to initialize. Please refresh the page.', 'error');
    }
  }

  /**
   * Load employees from Airtable
   */
  async function loadEmployees() {
    try {
      allEmployees = await window.ClockInAPI.getAllEmployees();
      console.log('[Clock In] Loaded employees:', allEmployees.length);
      populateEmployeeDatalist();
    } catch (error) {
      console.error('[Clock In] Error loading employees:', error);
    }
  }

  /**
   * Populate the employee datalists for autocomplete
   */
  function populateEmployeeDatalist() {
    const clockInList = document.getElementById('clockInEmployeeList');
    
    const options = allEmployees.map(emp => 
      `<option value="${emp.fullName}" data-id="${emp.employeeId}">${emp.fullName} (${emp.department})</option>`
    ).join('');
    
    if (clockInList) clockInList.innerHTML = options;
  }

  /**
   * Handle attendance search input for custom suggestions
   */
  function handleAttendanceSearchInput(e) {
    const searchValue = e.target.value.toLowerCase().trim();
    const suggestionsContainer = document.getElementById('employeeSuggestions');
    
    if (!suggestionsContainer) return;
    
    if (!searchValue || searchValue.length < 1) {
      hideSuggestions();
      return;
    }
    
    // Filter employees matching the search
    const matches = allEmployees.filter(emp => 
      emp.fullName.toLowerCase().includes(searchValue) ||
      emp.employeeId.toLowerCase().includes(searchValue) ||
      emp.firstName.toLowerCase().includes(searchValue) ||
      emp.lastName.toLowerCase().includes(searchValue) ||
      (emp.department && emp.department.toLowerCase().includes(searchValue))
    ).slice(0, 8); // Limit to 8 results
    
    if (matches.length === 0) {
      // Just hide suggestions when no match during typing - don't show popup
      hideSuggestions();
      return;
    }
    
    // Build suggestions HTML
    const suggestionsHTML = matches.map(emp => {
      const initials = getInitials(emp.fullName);
      return `
        <div class="suggestion-item" data-employee-id="${emp.employeeId}" data-name="${emp.fullName}">
          <div class="suggestion-avatar">${initials}</div>
          <div class="suggestion-info">
            <div class="suggestion-name">${emp.fullName}</div>
            <div class="suggestion-details">
              <span class="suggestion-id">🆔 ${emp.employeeId}</span>
              <span>🏢 ${emp.department || 'N/A'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    suggestionsContainer.innerHTML = suggestionsHTML;
    suggestionsContainer.classList.add('active');
    
    // Add click handlers to suggestions
    suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        document.getElementById('attendanceSearchInput').value = name;
        hideSuggestions();
        searchAttendance();
      });
    });
  }
  
  /**
   * Get initials from full name
   */
  function getInitials(name) {
    return name
      .split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
  }
  
  /**
   * Hide suggestions dropdown
   */
  function hideSuggestions() {
    const suggestionsContainer = document.getElementById('employeeSuggestions');
    if (suggestionsContainer) {
      suggestionsContainer.classList.remove('active');
    }
  }

  /**
   * Switch between tabs
   */
  function switchTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      }
    });
    
    // Update tab panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });
    
    const targetPane = document.getElementById(`tab-${tabId}`);
    if (targetPane) {
      targetPane.classList.add('active');
    }
  }

  /**
   * Set up all event listeners
   */
  function setupEventListeners() {
    // Clock action buttons
    document.getElementById('btnMorningIn')?.addEventListener('click', () => showClockModal('TimeInAM', 'Morning Time In'));
    document.getElementById('btnMorningOut')?.addEventListener('click', () => showClockModal('TimeOutAM', 'Morning Time Out'));
    document.getElementById('btnAfternoonIn')?.addEventListener('click', () => showClockModal('TimeInPM', 'Afternoon Time In'));
    document.getElementById('btnAfternoonOut')?.addEventListener('click', () => showClockModal('TimeOutPM', 'Afternoon Time Out'));
    
    // Modal controls
    document.getElementById('closeClockModal')?.addEventListener('click', closeClockModal);
    document.getElementById('clockInModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'clockInModal') closeClockModal();
    });
    
    // Global keyboard listener (document level) - allows Enter to save even without input focus
    document.addEventListener('keydown', handleGlobalKeydown);
    
    // Search results modal controls
    document.getElementById('closeSearchResultsModal')?.addEventListener('click', closeSearchResultsModal);
    document.getElementById('searchResultsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'searchResultsModal') closeSearchResultsModal();
    });
    
    // Modal date filter
    document.getElementById('btnModalApplyDateFilter')?.addEventListener('click', loadEmployeeAttendanceModal);
    
    // Modal date preset buttons
    document.querySelectorAll('#searchResultsModal .preset-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', (e) => handleModalDatePreset(e.target.dataset.preset));
    });
    
    // Employee search in modal
    const clockInSearch = document.getElementById('clockInEmployeeSearch');
    if (clockInSearch) {
      clockInSearch.addEventListener('input', handleClockInSearch);
      clockInSearch.addEventListener('keydown', handleClockInKeydown);
      clockInSearch.addEventListener('focus', handleClockInSearch);
    }
    
    // Attendance search
    document.getElementById('btnSearchAttendance')?.addEventListener('click', searchAttendance);
    const attendanceSearchInput = document.getElementById('attendanceSearchInput');
    if (attendanceSearchInput) {
      attendanceSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchAttendance();
        if (e.key === 'Escape') hideSuggestions();
      });
      attendanceSearchInput.addEventListener('input', handleAttendanceSearchInput);
      attendanceSearchInput.addEventListener('focus', handleAttendanceSearchInput);
      // Close suggestions when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-input-container')) {
          hideSuggestions();
        }
      });
    }
    
    // Today's Attendance search/filter
    const todaySearchInput = document.getElementById('todaySearchInput');
    if (todaySearchInput) {
      todaySearchInput.addEventListener('input', handleTodaySearchInput);
    }
    
    // Date filter
    document.getElementById('btnApplyDateFilter')?.addEventListener('click', applyDateFilter);
    
    // Date preset buttons
    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', (e) => handleDatePreset(e.target.dataset.preset));
    });
    
    // Tab navigation
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => switchTab(e.target.closest('.tab-btn').dataset.tab));
    });
  }

  /**
   * Handle date preset button clicks
   */
  function handleDatePreset(preset) {
    const now = new Date();
    let fromDate, toDate;
    
    switch (preset) {
      case 'this-month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-month':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'last-3-months':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-6-months':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'this-year':
        fromDate = new Date(now.getFullYear(), 0, 1);
        toDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'all-time':
        fromDate = null;
        toDate = null;
        break;
      default:
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    // Update date inputs
    const fromInput = document.getElementById('attendanceFromDate');
    const toInput = document.getElementById('attendanceToDate');
    
    if (fromInput) fromInput.value = fromDate ? fromDate.toISOString().split('T')[0] : '';
    if (toInput) toInput.value = toDate ? toDate.toISOString().split('T')[0] : '';
    
    // Update active button state
    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    // Load attendance with new dates
    loadEmployeeAttendanceModal();
  }

  /**
   * Handle date preset for modal
   */
  function handleModalDatePreset(preset) {
    const now = new Date();
    let fromDate, toDate;
    
    switch (preset) {
      case 'this-month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-month':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'last-3-months':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-6-months':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'this-year':
        fromDate = new Date(now.getFullYear(), 0, 1);
        toDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'all-time':
        fromDate = null;
        toDate = null;
        break;
      default:
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    // Update modal date inputs
    const fromInput = document.getElementById('modalFromDate');
    const toInput = document.getElementById('modalToDate');
    
    if (fromInput) fromInput.value = fromDate ? fromDate.toISOString().split('T')[0] : '';
    if (toInput) toInput.value = toDate ? toDate.toISOString().split('T')[0] : '';
    
    // Update active button state in modal
    document.querySelectorAll('#searchResultsModal .preset-btn[data-preset]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    // Load attendance with new dates
    loadEmployeeAttendanceModal();
  }

  /**
   * Set default date filters (current month)
   */
  function setDefaultDateFilters() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const fromInput = document.getElementById('attendanceFromDate');
    const toInput = document.getElementById('attendanceToDate');
    
    if (fromInput) fromInput.value = firstDay.toISOString().split('T')[0];
    if (toInput) toInput.value = lastDay.toISOString().split('T')[0];
  }

  /**
   * Start the live clock
   */
  function startLiveClock() {
    updateLiveClock();
    clockInterval = setInterval(updateLiveClock, 1000);
  }

  /**
   * Update the live clock display
   */
  function updateLiveClock() {
    const now = new Date();
    
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
    
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    const mainClock = document.getElementById('mainClockDisplay');
    const mainDate = document.getElementById('mainDateDisplay');
    const modalClock = document.getElementById('modalClockDisplay');
    
    if (mainClock) mainClock.textContent = timeStr;
    if (mainDate) mainDate.textContent = dateStr;
    if (modalClock) modalClock.textContent = timeStr;
  }

  /**
   * Show the clock-in modal
   */
  function showClockModal(actionType, actionLabel) {
    currentClockAction = actionType;
    selectedEmployee = null;
    
    const modal = document.getElementById('clockInModal');
    const actionTitle = document.getElementById('clockActionTitle');
    const employeeInput = document.getElementById('clockInEmployeeSearch');
    const selectedDisplay = document.getElementById('selectedEmployeeDisplay');
    
    if (actionTitle) actionTitle.textContent = actionLabel;
    if (employeeInput) {
      employeeInput.value = '';
      setTimeout(() => employeeInput.focus(), 100);
    }
    if (selectedDisplay) selectedDisplay.innerHTML = '';
    
    if (modal) modal.style.display = 'flex';
  }

  /**
   * Close the clock-in modal and reset all fields
   */
  function closeClockModal() {
    const modal = document.getElementById('clockInModal');
    if (modal) modal.style.display = 'none';
    
    // Clear input field
    const searchInput = document.getElementById('clockInEmployeeSearch');
    if (searchInput) searchInput.value = '';
    
    // Clear suggestions
    const suggestionsContainer = document.getElementById('clockInSuggestions');
    if (suggestionsContainer) {
      suggestionsContainer.classList.remove('active');
      suggestionsContainer.innerHTML = '';
    }
    
    // Clear selected employee display
    const selectedDisplay = document.getElementById('selectedEmployeeDisplay');
    if (selectedDisplay) selectedDisplay.innerHTML = '';
    
    // Reset state
    currentClockAction = null;
    selectedEmployee = null;
  }

  /**
   * Clear the clock modal fields without closing
   */
  function clearClockModalFields() {
    const searchInput = document.getElementById('clockInEmployeeSearch');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    
    const suggestionsContainer = document.getElementById('clockInSuggestions');
    if (suggestionsContainer) {
      suggestionsContainer.classList.remove('active');
      suggestionsContainer.innerHTML = '';
    }
    
    const selectedDisplay = document.getElementById('selectedEmployeeDisplay');
    if (selectedDisplay) selectedDisplay.innerHTML = '';
    
    selectedEmployee = null;
  }

  /**
   * Handle employee search input in clock modal
   */
  function handleClockInSearch(e) {
    const searchValue = e.target.value.toLowerCase().trim();
    const suggestionsContainer = document.getElementById('clockInSuggestions');
    
    if (!suggestionsContainer) return;
    
    if (!searchValue || searchValue.length < 1) {
      suggestionsContainer.classList.remove('active');
      selectedEmployee = null;
      updateSelectedEmployeeDisplay();
      return;
    }
    
    // Filter employees matching the search
    const matches = allEmployees.filter(emp => 
      emp.fullName.toLowerCase().includes(searchValue) ||
      emp.employeeId.toLowerCase().includes(searchValue) ||
      emp.firstName.toLowerCase().includes(searchValue) ||
      emp.lastName.toLowerCase().includes(searchValue) ||
      (emp.department && emp.department.toLowerCase().includes(searchValue))
    ).slice(0, 6); // Limit to 6 results for modal
    
    if (matches.length === 0) {
      // Just hide suggestions when no match during typing - don't show popup
      suggestionsContainer.classList.remove('active');
      suggestionsContainer.innerHTML = '';
      return;
    }
    
    // Build suggestions HTML
    const suggestionsHTML = matches.map(emp => {
      const initials = getInitials(emp.fullName);
      return `
        <div class="modal-suggestion-item" data-employee-id="${emp.employeeId}" data-name="${emp.fullName}">
          <div class="modal-suggestion-avatar">${initials}</div>
          <div class="modal-suggestion-info">
            <div class="modal-suggestion-name">${emp.fullName}</div>
            <div class="modal-suggestion-details">
              <span class="modal-suggestion-id">${emp.employeeId}</span>
              <span>${emp.department || 'N/A'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    suggestionsContainer.innerHTML = suggestionsHTML;
    suggestionsContainer.classList.add('active');
    
    // Add click handlers to suggestions
    suggestionsContainer.querySelectorAll('.modal-suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const employeeId = item.dataset.employeeId;
        const name = item.dataset.name;
        const emp = allEmployees.find(e => e.employeeId === employeeId);
        
        if (emp) {
          selectedEmployee = emp;
          const searchInput = document.getElementById('clockInEmployeeSearch');
          if (searchInput) {
            searchInput.value = name;
            searchInput.focus(); // Keep focus on input so user can press Enter
          }
          updateSelectedEmployeeDisplay();
          suggestionsContainer.classList.remove('active');
          console.log('[Clock In] Employee selected:', emp.fullName, '- Press Enter to save');
        }
      });
    });
  }

  /**
   * Handle Enter key in clock modal
   */
  function handleClockInKeydown(e) {
    if (e.key === 'Escape') {
      const suggestionsContainer = document.getElementById('clockInSuggestions');
      if (suggestionsContainer) suggestionsContainer.classList.remove('active');
      return;
    }
    
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      
      const suggestionsContainer = document.getElementById('clockInSuggestions');
      if (suggestionsContainer) suggestionsContainer.classList.remove('active');
      
      // If employee already selected, save immediately
      if (selectedEmployee) {
        console.log('[Clock In] Enter pressed, saving for:', selectedEmployee.fullName);
        saveClockRecord();
        return;
      }
      
      const searchValue = e.target.value.trim();
      const searchLower = searchValue.toLowerCase();
      
      if (!searchValue) {
        showNotification('Please enter an employee name or ID.', 'error');
        return;
      }
      
      // Find matching employee - prioritize exact Employee ID match
      let match = allEmployees.find(emp => 
        emp.employeeId.toLowerCase() === searchLower
      );
      
      // If no exact ID match, try name match
      if (!match) {
        match = allEmployees.find(emp => 
          emp.fullName.toLowerCase() === searchLower ||
          emp.fullName.toLowerCase().includes(searchLower)
        );
      }
      
      if (match) {
        selectedEmployee = match;
        e.target.value = match.fullName;
        updateSelectedEmployeeDisplay();
        console.log('[Clock In] Employee matched, saving for:', match.fullName);
        saveClockRecord();
      } else {
        showNotification(`Employee not found: ${searchValue}`, 'error');
        clearClockModalFields();
      }
    }
  }

  /**
   * Global keyboard handler - works anywhere on the page
   * Allows Enter to save when employee is selected in modal
   */
  function handleGlobalKeydown(e) {
    // Only handle if clock modal is visible
    const modal = document.getElementById('clockInModal');
    if (!modal || modal.style.display === 'none') return;
    
    if (e.key === 'Escape') {
      closeClockModal();
      return;
    }
    
    if (e.key === 'Enter') {
      // If employee is selected, save - regardless of where focus is
      if (selectedEmployee) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Clock In] Enter pressed (global), saving for:', selectedEmployee.fullName);
        saveClockRecord();
      }
    }
  }

  /**
   * Update the selected employee display in modal
   */
  function updateSelectedEmployeeDisplay() {
    const display = document.getElementById('selectedEmployeeDisplay');
    if (!display) return;
    
    if (selectedEmployee) {
      display.innerHTML = `
        <div class="selected-info">
          <span class="selected-name">✓ ${selectedEmployee.fullName}</span>
          <span class="selected-dept">(${selectedEmployee.department})</span>
        </div>
      `;
    } else {
      display.innerHTML = '';
    }
  }

  /**
   * Save the clock record
   */
  async function saveClockRecord() {
    if (!selectedEmployee) {
      showNotification('Please select an employee first.', 'error');
      return;
    }
    
    if (!currentClockAction) {
      showNotification('Invalid clock action.', 'error');
      return;
    }
    
    const now = new Date();
    const timeValue = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    const dateValue = now.toISOString().split('T')[0];
    
    // Prevent multiple saves
    if (isSaving) {
      console.log('[Clock In] Already saving, ignoring duplicate request');
      return;
    }
    
    // Store employee info before async operations (in case it gets cleared)
    const employeeId = selectedEmployee.employeeId;
    const employeeName = selectedEmployee.fullName;
    const actionType = currentClockAction;
    
    isSaving = true;
    
    try {
      // Check if there's an existing record for today
      const existingRecord = await window.ClockInAPI.findTodayRecord(employeeId, dateValue);
      
      if (existingRecord) {
        // Update existing record
        await window.ClockInAPI.updateAttendanceRecord(existingRecord.id, actionType, timeValue);
      } else {
        // Create new record
        await window.ClockInAPI.createAttendanceRecord(employeeId, dateValue, actionType, timeValue);
      }
      
      showNotification(`${employeeName} - ${getActionLabel(actionType)} recorded at ${timeValue}`, 'success');
      
      // Refresh today's attendance
      await loadTodayAttendance();
      
      // Close modal
      closeClockModal();
      
    } catch (error) {
      console.error('[Clock In] Error saving record:', error);
      showNotification('Failed to save attendance record. Please try again.', 'error');
      clearClockModalFields();
    } finally {
      isSaving = false;
    }
  }

  /**
   * Get friendly label for clock action
   */
  function getActionLabel(actionType) {
    const labels = {
      'TimeInAM': 'Morning Time In',
      'TimeOutAM': 'Morning Time Out',
      'TimeInPM': 'Afternoon Time In',
      'TimeOutPM': 'Afternoon Time Out'
    };
    return labels[actionType] || actionType;
  }

  /**
   * Load today's attendance for all employees
   */
  async function loadTodayAttendance() {
    const refreshBtn = document.getElementById('btnRefreshAttendance');
    const originalText = refreshBtn ? refreshBtn.innerHTML : '';
    
    try {
      // Show refreshing state
      if (refreshBtn) {
        refreshBtn.innerHTML = '<span class="spinning">↻</span> Refreshing...';
        refreshBtn.disabled = true;
      }
      
      // Update the today's date display
      const todayDateDisplay = document.getElementById('todayDateDisplay');
      if (todayDateDisplay) {
        const today = new Date();
        todayDateDisplay.textContent = today.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
      
      todayAttendance = await window.ClockInAPI.getTodayAttendance();
      renderTodayAttendance();
    } catch (error) {
      console.error('[Clock In] Error loading today\'s attendance:', error);
    } finally {
      // Restore button state
      if (refreshBtn) {
        refreshBtn.innerHTML = originalText;
        refreshBtn.disabled = false;
      }
    }
  }

  /**
   * Render today's attendance table
   */
  function renderTodayAttendance(filterText = '') {
    const tbody = document.getElementById('todayAttendanceBody');
    if (!tbody) return;
    
    // Filter attendance based on search text
    let filteredAttendance = todayAttendance;
    if (filterText) {
      const searchLower = filterText.toLowerCase();
      filteredAttendance = todayAttendance.filter(record => {
        const fields = record.fields;
        const employee = allEmployees.find(e => e.employeeId === fields.EmployeeId);
        const employeeName = employee ? employee.fullName.toLowerCase() : '';
        const employeeId = (fields.EmployeeId || '').toLowerCase();
        return employeeName.includes(searchLower) || employeeId.includes(searchLower);
      });
    }
    
    if (filteredAttendance.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="no-data">${filterText ? 'No matching employees found.' : 'No attendance records for today yet.'}</td>
        </tr>
      `;
      return;
    }
    
    tbody.innerHTML = filteredAttendance.map(record => {
      const fields = record.fields;
      const employee = allEmployees.find(e => e.employeeId === fields.EmployeeId);
      const employeeName = employee ? employee.fullName : fields.EmployeeId;
      
      return `
        <tr class="clickable-row" data-employee-id="${fields.EmployeeId}" data-employee-name="${employeeName}" title="Click to view attendance history">
          <td>
            <div class="employee-cell">
              <span class="employee-name">${employeeName}</span>
              <span class="employee-id">${fields.EmployeeId || ''}</span>
            </div>
          </td>
          <td>${formatTime12Hour(fields.TimeInAM)}</td>
          <td>${formatTime12Hour(fields.TimeOutAM)}</td>
          <td>${formatTime12Hour(fields.TimeInPM)}</td>
          <td>${formatTime12Hour(fields.TimeOutPM)}</td>
          <td>${getAttendanceStatusBadge(fields, employee)}</td>
        </tr>
      `;
    }).join('');

    // Add click handlers to rows
    tbody.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const employeeId = row.dataset.employeeId;
        const employeeName = row.dataset.employeeName;
        viewEmployeeHistory(employeeId, employeeName);
      });
    });
  }

  /**
   * View employee attendance history in popup
   */
  async function viewEmployeeHistory(employeeId, employeeName) {
    // Find employee object
    const employee = allEmployees.find(e => e.employeeId === employeeId);
    if (employee) {
      searchedEmployee = employee;
    } else {
      searchedEmployee = { employeeId: employeeId, fullName: employeeName };
    }

    // Update employee info header
    const employeeInfo = document.getElementById('modalEmployeeInfo');
    if (employeeInfo) {
      const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase();
      employeeInfo.innerHTML = `
        <div class="modal-employee-avatar">${initials}</div>
        <div class="modal-employee-details">
          <h3 class="modal-employee-name">${employeeName}</h3>
          <div class="modal-employee-meta">
            <span>ID: ${employeeId}</span>
          </div>
        </div>
      `;
    }

    // Update modal title with employee name
    const title = document.getElementById('modalResultsTitle');
    if (title) {
      title.textContent = `Attendance Records`;
    }

    // Show the modal
    const modal = document.getElementById('searchResultsModal');
    if (modal) {
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
    }

    // Load and display the attendance records
    await loadEmployeeAttendanceModal();
  }

  /**
   * Handle Today's Attendance search/filter
   */
  function handleTodaySearchInput(e) {
    const filterText = e.target.value.trim();
    renderTodayAttendance(filterText);
  }

  /**
   * Search attendance for an employee
   */
  async function searchAttendance() {
    const searchInput = document.getElementById('attendanceSearchInput');
    if (!searchInput) return;
    
    const searchValue = searchInput.value.toLowerCase().trim();
    
    if (!searchValue) {
      showNotification('Please enter a name or Employee ID to search.', 'warning');
      return;
    }
    
    // Find matching employee - first try exact match, then partial match
    let match = allEmployees.find(emp => 
      emp.fullName.toLowerCase() === searchValue ||
      emp.employeeId.toLowerCase() === searchValue
    );
    
    // If no exact match, try partial match
    if (!match) {
      match = allEmployees.find(emp => 
        emp.fullName.toLowerCase().includes(searchValue) ||
        emp.firstName.toLowerCase().includes(searchValue) ||
        emp.lastName.toLowerCase().includes(searchValue) ||
        emp.employeeId.toLowerCase().includes(searchValue)
      );
    }
    
    if (!match) {
      // Show popup notification for not found
      const suggestionsContainer = document.getElementById('employeeSuggestions');
      if (suggestionsContainer) {
        suggestionsContainer.innerHTML = `
          <div class="no-suggestions-backdrop" onclick="document.getElementById('employeeSuggestions').classList.remove('active')"></div>
          <div class="no-suggestions">
            <button class="no-suggestions-close" onclick="document.getElementById('employeeSuggestions').classList.remove('active')">&times;</button>
            Employee not found. Please check the name or ID.
          </div>
        `;
        suggestionsContainer.classList.add('active');
      }
      return;
    }
    
    searchedEmployee = match;
    
    // Show modal with employee info
    const modal = document.getElementById('searchResultsModal');
    const employeeInfo = document.getElementById('modalEmployeeInfo');
    
    if (employeeInfo) {
      const initials = getInitials(match.fullName);
      employeeInfo.innerHTML = `
        <div class="modal-employee-avatar">${initials}</div>
        <div class="modal-employee-details">
          <h2 class="modal-employee-name">${match.fullName}</h2>
          <div class="modal-employee-meta">
            <span>🆔 ${match.employeeId}</span>
            <span>🏢 ${match.department || 'N/A'}</span>
          </div>
        </div>
      `;
    }
    
    // Show the modal
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    // Set default date range (this month)
    setDefaultDateRange();
    
    // Load attendance records
    await loadEmployeeAttendanceModal();
  }

  /**
   * Set default date range to current month
   */
  function setDefaultDateRange() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const fromInput = document.getElementById('modalFromDate');
    const toInput = document.getElementById('modalToDate');
    
    if (fromInput) fromInput.value = firstDay.toISOString().split('T')[0];
    if (toInput) toInput.value = lastDay.toISOString().split('T')[0];
  }

  /**
   * Load attendance records for modal display
   */
  async function loadEmployeeAttendanceModal() {
    if (!searchedEmployee) return;
    
    const fromDate = document.getElementById('modalFromDate')?.value;
    const toDate = document.getElementById('modalToDate')?.value;
    
    try {
      searchedAttendance = await window.ClockInAPI.getAttendanceByEmployee(
        searchedEmployee.employeeId,
        fromDate,
        toDate
      );
      
      renderModalAttendance();
    } catch (error) {
      console.error('[Clock In] Error loading employee attendance:', error);
      showNotification('Failed to load attendance records.', 'error');
    }
  }

  /**
   * Apply date filter (legacy inline version)
   */
  async function applyDateFilter() {
    await loadEmployeeAttendanceModal();
  }

  /**
   * Render attendance in modal
   */
  function renderModalAttendance() {
    const tbody = document.getElementById('modalAttendanceBody');
    const title = document.getElementById('modalResultsTitle');
    const summary = document.getElementById('modalAttendanceSummary');
    
    if (!tbody) return;
    
    // Update title
    if (title && searchedEmployee) {
      title.textContent = `Attendance Records`;
    }
    
    if (searchedAttendance.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="no-data">No attendance records found for the selected period.</td>
        </tr>
      `;
      if (summary) summary.innerHTML = '';
      return;
    }
    
    // Calculate summary
    let presentDays = 0;
    let lateDays = 0;
    let totalHours = 0;
    
    searchedAttendance.forEach(record => {
      if (record.timeInAM || record.timeInPM) presentDays++;
      if (record.timeInAM && isLate(record.timeInAM)) lateDays++;
      totalHours += parseFloat(record.totalHoursWorked) || 0;
    });
    
    // Render summary
    if (summary) {
      summary.innerHTML = `
        <span>📅 ${searchedAttendance.length} records</span>
        <span>✅ ${presentDays} days present</span>
        <span>⏰ ${formatHoursMinutes(totalHours)} total</span>
      `;
    }
    
    // Render table
    tbody.innerHTML = searchedAttendance.map(record => {
      const dateStr = record.date ? new Date(record.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) : '-';
      
      return `
        <tr>
          <td>${dateStr}</td>
          <td>${formatTime12Hour(record.timeInAM)}</td>
          <td>${formatTime12Hour(record.timeOutAM)}</td>
          <td>${formatTime12Hour(record.timeInPM)}</td>
          <td>${formatTime12Hour(record.timeOutPM)}</td>
          <td>${formatHoursMinutes(record.totalHoursWorked)}</td>
          <td>${getAttendanceStatusBadge(record, searchedEmployee)}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Close search results modal
   */
  function closeSearchResultsModal() {
    const modal = document.getElementById('searchResultsModal');
    if (modal) {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }
  }

  // Legacy functions for inline display (keeping for backward compatibility)
  /**
   * Show employee info inline (legacy)
   */
  function showInlineEmployeeInfo() {
    const employeeInfo = document.getElementById('searchEmployeeInfo');
    if (employeeInfo && searchedEmployee) {
      employeeInfo.innerHTML = `
        <div class="employee-name">👤 ${searchedEmployee.fullName}</div>
        <div class="employee-details">
          Employee ID: ${searchedEmployee.employeeId} | Department: ${searchedEmployee.department}
        </div>
      `;
      employeeInfo.style.display = 'block';
    }
    
    document.getElementById('dateFilterSection').style.display = 'block';
    document.getElementById('attendanceResultsSection').style.display = 'block';
  }

  /**
   * Format time to 12-hour format with AM/PM
   * Handles both 24-hour format (14:30) and existing 12-hour format (02:30 PM)
   */
  function formatTime12Hour(time) {
    if (!time) return '-';
    
    // If already has AM/PM, return as is
    if (time.includes('AM') || time.includes('PM')) {
      return time;
    }
    
    // Parse 24-hour format
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return time;
    
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  /**
   * Format decimal hours to hours and minutes (e.g., 10.25 -> "10h 15m")
   */
  function formatHoursMinutes(decimalHours) {
    if (!decimalHours && decimalHours !== 0) return '-';
    
    const totalMinutes = Math.round(decimalHours * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    if (hours === 0 && minutes === 0) return '0m';
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  /**
   * Check if time-in is late (after 8:00 AM)
   */
  function isLate(timeIn) {
    if (!timeIn) return false;
    
    // Handle both 24-hour and 12-hour formats
    let hours, minutes;
    if (timeIn.includes('AM') || timeIn.includes('PM')) {
      const isPM = timeIn.includes('PM');
      const timePart = timeIn.replace(/\s*(AM|PM)/i, '');
      [hours, minutes] = timePart.split(':').map(Number);
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    } else {
      [hours, minutes] = timeIn.split(':').map(Number);
    }
    
    return hours > 8 || (hours === 8 && minutes > 0);
  }

  /**
   * Get attendance status badge HTML
   * Status logic matches attendance.js:
   * - Absent: No AM and no PM
   * - Invalid: Less than 30 minutes worked
   * - Short Hours: Some work but less than half day threshold
   * - Half Day: Only AM or PM with enough hours
   * - Overtime: More than standard hours
   * - Present/Complete: Full day with standard hours
   * - In Progress: Today's record still being worked
   */
  function getAttendanceStatusBadge(record, employee = null) {
    const fields = record.fields || record;
    
    // Get time values
    const timeInAM = fields.TimeInAM || fields.timeInAM;
    const timeOutAM = fields.TimeOutAM || fields.timeOutAM;
    const timeInPM = fields.TimeInPM || fields.timeInPM;
    const timeOutPM = fields.TimeOutPM || fields.timeOutPM;
    
    const hasAM = timeInAM && timeOutAM;
    const hasPM = timeInPM && timeOutPM;
    
    // Check if record is from today
    const recordDate = fields.Date || fields.date;
    const today = new Date().toISOString().split('T')[0];
    const isToday = recordDate === today;
    
    // Get total hours worked
    const totalHours = Number(fields.TotalHoursWorked || fields.totalHoursWorked) || 0;
    
    // Get employee's standard work hours (use employee data or default to 40)
    const standardWorkweekHours = Number(employee?.standardWorkweekHours) || 40;
    const dailyStd = standardWorkweekHours / 7;
    const tol = 0.01;
    const minHoursForHalfDay = dailyStd / 2 * 0.75; // At least 75% of half day
    const minHoursForValid = 0.5; // 30 minutes
    
    // Check leave type
    const leaveType = fields.LeaveType || fields.leaveType || '';
    if (leaveType && leaveType !== 'None' && leaveType !== '') {
      return '<span class="status-badge status-leave">On Leave</span>';
    }
    
    // Absent: No AM and no PM time entries
    if (!hasAM && !hasPM) {
      // If today and has any time in (but no time out yet), it's in progress
      if (isToday && (timeInAM || timeInPM)) {
        return '<span class="status-badge status-in-progress">In Progress</span>';
      }
      return '<span class="status-badge status-absent">Absent</span>';
    }
    
    // Only AM or PM completed (Half Day scenario)
    if ((hasAM && !hasPM) || (!hasAM && hasPM)) {
      // If today and might still clock in for other half
      if (isToday) {
        return '<span class="status-badge status-in-progress">In Progress</span>';
      }
      
      // Past day - check hours worked
      if (totalHours < minHoursForValid) {
        return '<span class="status-badge status-invalid">Invalid</span>';
      } else if (totalHours < minHoursForHalfDay) {
        return '<span class="status-badge status-short-hours">Short Hours</span>';
      } else {
        return '<span class="status-badge status-half-day">Half Day</span>';
      }
    }
    
    // Both AM and PM completed - check total hours
    if (totalHours < (dailyStd - tol)) {
      return '<span class="status-badge status-short-hours">Short Hours</span>';
    } else if (totalHours > (dailyStd + tol)) {
      return '<span class="status-badge status-overtime">Overtime</span>';
    } else {
      return '<span class="status-badge status-complete">Present</span>';
    }
  }

  /**
   * Show notification
   */
  function showNotification(message, type = 'success') {
    const notification = document.getElementById('clockNotification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
      notification.style.display = 'none';
    }, 4000);
  }

  // Expose functions globally
  window.loadTodayAttendance = loadTodayAttendance;
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
