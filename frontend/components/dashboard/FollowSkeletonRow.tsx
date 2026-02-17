'use client';

export default function FollowSkeletonRow() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      {/* Date */}
      <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px]">
        <div className="h-4 bg-gray-200 rounded w-28 mx-auto"></div>
      </td>
      {/* Staff ID */}
      <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px]">
        <div className="flex items-center gap-x-2 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="h-4 bg-gray-200 rounded w-20"></div>
        </div>
      </td>
      {/* Staff Name */}
      <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px]">
        <div className="flex items-center gap-x-2 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="h-4 bg-gray-200 rounded w-24"></div>
        </div>
      </td>
      {/* Summary icons */}
      <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
        <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
          <div className="w-5 h-5 bg-gray-200 rounded-[5px]"></div>
        </div>
      </td>
      {/* STT icon */}
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
