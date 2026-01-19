/**
 * Utility functions for dashboard
 */

/**
 * Generate a file ID in the format originalname-YYYYMMDDHHMMSS
 */
export const generateFileId = (originalName: string): string => {
  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  return `${originalName}-${dateStr}`;
};

/**
 * Parse date string for sorting
 */
export const parseDate = (dateString: string): number => {
  try {
    // Handle DD/MM/YY format
    if (dateString.includes('/')) {
      const [day, month, year] = dateString.split(' ')[0].split('/');
      const time = dateString.split(' ')[1];
      // Convert 2-digit year to 4-digit year
      const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
      dateString = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${time}`;
    }
    return new Date(dateString).getTime();
  } catch (error) {
    console.error('Error parsing date for sorting:', error);
    return 0; // Return 0 for invalid dates to sort them to the end
  }
};

/**
 * Format date string for display (MM/DD HH:mm)
 */
export const formatDate = (dateString: string): string => {
  try {
    // Handle DD/MM/YY format
    if (dateString.includes('/')) {
      const [day, month, year] = dateString.split(' ')[0].split('/');
      const time = dateString.split(' ')[1];
      // Convert 2-digit year to 4-digit year
      const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
      dateString = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${time}`;
    }

    const date = new Date(dateString);
    
    // If the date is invalid, return the original string
    if (isNaN(date.getTime())) {
      console.warn('Invalid date string:', dateString);
      return dateString;
    }

    // Format the date in MM/DD HH:mm format
    const month = String(date.getMonth() + 1);
    const day = String(date.getDate());
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${month}/${day} ${hours}:${minutes}`;
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString;
  }
};

/**
 * Truncate memo text (first 5 characters)
 */
export const truncateMemo = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.length > 5 ? text.substring(0, 5) + '...' : text;
};

/**
 * Truncate File ID (first 17 lowercase characters)
 */
export const truncateFileId = (fileId: string | null | undefined): string => {
  if (!fileId) return '';
  const lowerCase = fileId.toLowerCase();
  return lowerCase.length > 17 ? lowerCase.substring(0, 17) + '...' : lowerCase;
};

/**
 * Convert data to array (handles JSON strings, arrays, etc.)
 */
export const convertToArray = (data: any): string[] => {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [data];
    }
  }
  return [];
};
