'use client';

export default function RecordSkeletonRow() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      {/* Staff ID */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center gap-x-2 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="h-4 bg-gray-200 rounded w-20"></div>
        </div>
      </td>
      {/* Staff Name */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center gap-x-2 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="h-4 bg-gray-200 rounded w-24"></div>
        </div>
      </td>
      {/* Date */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="h-4 bg-gray-200 rounded w-28 mx-auto"></div>
      </td>
      {/* User */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="h-4 bg-gray-200 rounded w-20 mx-auto"></div>
      </td>
      {/* Memo */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center gap-x-2">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="h-4 bg-gray-200 rounded flex-1 max-w-[150px]"></div>
        </div>
      </td>
      {/* File ID */}
      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
        <div className="h-4 bg-gray-200 rounded w-24 mx-auto"></div>
      </td>
      {/* Skill Sheet icons */}
      <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* Salesforce icons */}
      <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* LoR icons */}
      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
        <div className="flex items-center justify-center rounded-[5px] gap-x-2">
          <div className="w-4 h-4 bg-gray-200 rounded-[5px]"></div>
          <div className="w-4 h-4 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* STT icons */}
      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
        <div className="flex items-center justify-center rounded-[5px]">
          <div className="w-4 h-4 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* Bulk icons */}
      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
        <div className="flex items-center justify-center rounded-[5px]">
          <div className="w-4 h-4 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* Delete button */}
      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
        <div className="flex items-center justify-center rounded-[5px]">
          <div className="w-4 h-4 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
    </tr>
  );
}
