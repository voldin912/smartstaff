# Dashboard Refactoring Guide

## Completed Components

### 1. API Utility (`frontend/lib/api.ts`)
- ✅ Enhanced error handling with 401/403 logout
- ✅ Retry logic for network errors
- ✅ Consistent error messages
- ✅ Proper error types (ApiException)

### 2. Utility Functions (`frontend/lib/utils.ts`)
- ✅ Date formatting and parsing
- ✅ Text truncation helpers
- ✅ File ID generation
- ✅ Array conversion utilities

### 3. Types (`frontend/lib/types.ts`)
- ✅ Record interface
- ✅ UploadStatus interface
- ✅ AlertMessage interface
- ✅ Sort types

### 4. Custom Hook (`frontend/hooks/useRecords.ts`)
- ✅ Records fetching with error handling
- ✅ Loading states
- ✅ Refetch capability

### 5. UI Components
- ✅ `AlertMessage` - Auto-dismissing alerts
- ✅ `UploadModal` - Upload progress modal
- ✅ `DeleteModal` - Delete confirmation
- ✅ `SalesforceSyncModal` - Salesforce sync confirmation
- ✅ `DashboardHeader` - Header with upload button

## Remaining Work

### 1. RecordsTable Component
The table is complex with:
- Inline editing for Staff ID, Staff Name, Memo
- Multiple action buttons per row
- Sorting functionality
- Search functionality
- Pagination (already exists as separate component)

**Recommendation**: Break into smaller components:
- `RecordsTable` - Main table wrapper
- `RecordsTableHeader` - Table header with sorting
- `RecordsTableRow` - Individual row component
- `EditableCell` - Reusable inline editing cell
- `ActionButtons` - Group of action buttons

### 2. Refactor Main Dashboard Pages
Both `admin/dashboard/page.tsx` and `[companySlug]/dashboard/page.tsx` need to:
- Use the new components
- Use the `useRecords` hook
- Use `apiRequest` for all API calls
- Remove duplicate code

## Next Steps

1. Create `RecordsTable` component (can be done incrementally)
2. Create API service functions for all record operations
3. Refactor main dashboard pages to use new structure
4. Test all functionality

## Benefits

- ✅ Better error handling (401/403 handled properly)
- ✅ Reusable components
- ✅ Easier to maintain
- ✅ Better separation of concerns
- ✅ Consistent error messages
