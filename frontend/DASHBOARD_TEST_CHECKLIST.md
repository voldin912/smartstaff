# Dashboard Test Checklist

## Admin Dashboard (`/admin/dashboard`)
## Company Dashboard (`/[companySlug]/dashboard`)

### 1. Initial Load & Data Display
- [ ] Page loads without errors
- [ ] Records table displays correctly
- [ ] Loading state shows while fetching data
- [ ] Empty state shows when no records exist
- [ ] All columns display correctly (Staff ID, Staff Name, Date, User, Memo, File, Skill Sheet, Salesforce, LoR, STT, Bulk, Delete)

### 2. File Upload
- [ ] Upload button is visible and clickable
- [ ] File input accepts only audio files
- [ ] File size validation (max 100MB) works
- [ ] Upload modal shows progress (uploading → transcribing → complete)
- [ ] Success message displays after upload
- [ ] Error message displays on upload failure
- [ ] Records refresh after successful upload
- [ ] Upload button is disabled during upload

### 3. Inline Editing (RecordsTable)
- [ ] Staff ID can be edited inline
- [ ] Staff Name can be edited inline
- [ ] Memo can be edited inline
- [ ] Changes save on blur
- [ ] Success/error messages display for edits
- [ ] Records refresh after successful edit

### 4. Search & Filtering
- [ ] Search box is visible
- [ ] Search filters by date, fileId, staffId, userName
- [ ] Search is case-insensitive
- [ ] Search updates results in real-time

### 5. Sorting
- [ ] Date column is sortable (asc/desc)
- [ ] File ID column is sortable (asc/desc)
- [ ] User Name column is sortable (asc/desc)
- [ ] Sort icons update correctly (↑/↓)
- [ ] Only one column sorted at a time

### 6. Pagination
- [ ] Pagination controls are visible
- [ ] Can change rows per page (10, 25, 50, 100)
- [ ] Can navigate between pages
- [ ] Page resets when changing rows per page
- [ ] Correct total count displayed

### 7. Skill Sheet Operations
- [ ] Edit button opens SkillSheetSidebar
- [ ] Can save skill sheet data
- [ ] Download button downloads PDF
- [ ] Salesforce sync button opens modal
- [ ] Success/error messages display

### 8. Salesforce Operations
- [ ] Edit button opens SalesforceSidebar
- [ ] Can save Salesforce data
- [ ] Download button downloads PDF
- [ ] Salesforce sync button opens modal
- [ ] Success/error messages display

### 9. LoR (Letter of Recommendation) Operations
- [ ] Edit button opens LoRSidebar
- [ ] Can save LoR data
- [ ] Copy button copies LoR to clipboard
- [ ] Success/error messages display

### 10. STT Download
- [ ] Download button is clickable
- [ ] Downloads STT file as PDF
- [ ] Success/error messages display

### 11. Bulk Download
- [ ] Download button is clickable
- [ ] Downloads bulk data as ZIP
- [ ] Success/error messages display

### 12. Delete Functionality
- [ ] Delete button is visible for each record
- [ ] Clicking delete opens confirmation modal
- [ ] Cancel button closes modal without deleting
- [ ] Confirm button deletes the record
- [ ] Success/error messages display
- [ ] Records refresh after deletion

### 13. Role-Based Access Control (Delete)
- [ ] **Admin**: Can delete all records
- [ ] **Company Manager**: Can delete records from their company only
- [ ] **Member**: Can delete only their own records
- [ ] Appropriate error messages for unauthorized deletions

### 14. Salesforce Sync Modal
- [ ] Modal opens when Salesforce icon is clicked
- [ ] Displays correct Staff ID
- [ ] Cancel button closes modal
- [ ] Sync button performs sync
- [ ] Success/error toast messages display

### 15. Error Handling
- [ ] 401 errors trigger logout
- [ ] 403 errors trigger logout
- [ ] Network errors show appropriate messages
- [ ] No empty catch blocks
- [ ] Consistent error message format

### 16. Alert Messages
- [ ] Success messages display correctly
- [ ] Error messages display correctly
- [ ] Messages auto-dismiss after 5 seconds
- [ ] Messages can be manually dismissed

### 17. Responsive Design
- [ ] Layout works on mobile devices
- [ ] Table is scrollable on small screens
- [ ] Buttons are accessible on touch devices

### 18. Sidebars
- [ ] SkillSheetSidebar opens/closes correctly
- [ ] SalesforceSidebar opens/closes correctly
- [ ] LoRSidebar opens/closes correctly
- [ ] Data persists when closing without saving

### 19. Data Refresh
- [ ] Records refresh after upload
- [ ] Records refresh after edit
- [ ] Records refresh after delete
- [ ] Records refresh after save operations

### 20. Performance
- [ ] Page loads within reasonable time
- [ ] No unnecessary re-renders
- [ ] Smooth scrolling and interactions
