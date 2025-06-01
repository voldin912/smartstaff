import React, { useState, useEffect } from 'react';

interface Career {
  from: string;
  to: string;
  'company name': string;
  'employee type': string;
  'work content': string;
}

interface SkillSheetData {
  [key: string]: Career;
}

interface SkillSheetSidebarProps {
  open: boolean;
  onClose: () => void;
  skillSheetData: any;
  skills?: string[];
  onSave: (data: any) => void;
}

const cleanJsonString = (str: string) => {
  if (typeof str !== 'string') return str;
  return str.replace(/```json\n?|\n?```/g, '').trim();
};

const SkillSheetSidebar = ({ open, onClose, skillSheetData, skills, onSave }: SkillSheetSidebarProps & { skills?: string | any }) => {
  const [localData, setLocalData] = useState<SkillSheetData>({});
  const [gogakuryoku, setGogakuryoku] = useState<string>('');
  const [shikaku, setShikaku] = useState<string>('');
  const [skillsList, setSkillsList] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [initialData, setInitialData] = useState<string>('');

  useEffect(() => {
    if (skillSheetData) {
      try {
        const cleanedData = cleanJsonString(skillSheetData);
        const parsedData = typeof cleanedData === 'string' ? JSON.parse(cleanedData) : cleanedData;
        setLocalData(parsedData);
        setInitialData(JSON.stringify(parsedData));
        setHasChanges(false);
      } catch (error) {
        console.error('Error parsing skill sheet data:', error);
        setLocalData({});
        setInitialData('{}');
        setHasChanges(false);
      }
    } else {
      setLocalData({});
      setInitialData('{}');
      setHasChanges(false);
    }
    let parsedSkills: any = {};
    if (skills) {
      if (typeof skills === 'string') {
        try {
          const cleaned = (skills as string).replace(/```json\n?|\n?```/g, '').trim();
          parsedSkills = JSON.parse(cleaned);
        } catch {
          parsedSkills = {};
        }
      } else if (typeof skills === 'object') {
        parsedSkills = skills;
      }
    }
    console.log("parsedSkills", parsedSkills);
    setGogakuryoku(
      Array.isArray(parsedSkills['語学力'])
        ? parsedSkills['語学力']
            .map((item: any) =>
              item && typeof item === 'object'
                ? [item['言語'], item['レベル']].filter(Boolean).join(':')
                : String(item)
            )
            .join(', ')
        : ''
    );
    setShikaku(Array.isArray(parsedSkills['資格']) ? parsedSkills['資格'].join(', ') : '');
    setSkillsList(Array.isArray(parsedSkills['スキル']) ? parsedSkills['スキル'].join(', ') : '');
  }, [skillSheetData, skills]);

  const handleChange = (careerKey: string, field: keyof Career, value: string) => {
    setLocalData(prev => {
      const newData = {
        ...prev,
        [careerKey]: {
          ...prev[careerKey],
          [field]: value,
        },
      };
      setHasChanges(JSON.stringify(newData) !== initialData);
      return newData;
    });
  };

  const handleSave = () => {
    const gogakuArr = gogakuryoku
      .split(',')
      .map(s => {
        const [lang, level] = s.split(':').map(x => x.trim());
        if (!lang) return null;
        return level ? { 言語: lang, レベル: level } : { 言語: lang };
      })
      .filter(Boolean);

    const cleanedSkills = {
      語学力: gogakuArr,
      資格: shikaku.split(',').map(s => s.trim()).filter(Boolean),
      スキル: skillsList.split(',').map(s => s.trim()).filter(Boolean),
    };
    const dataToSave = { skill_sheet: localData, skills: cleanedSkills };
    onSave(dataToSave);
    setInitialData(JSON.stringify(localData));
    setHasChanges(false);
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm('保存されていませんが画面を閉じますか？');
      if (confirmed) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black opacity-30" onClick={handleClose}></div>
      {/* Sidebar */}
      <div className="relative ml-auto w-full max-w-md h-full bg-white shadow-xl p-6 overflow-y-auto">
        <button className="absolute top-4 right-4 text-gray-500 hover:text-gray-700" onClick={handleClose}>
          <span className="text-2xl">&times;</span>
        </button>
        <h2 className="text-xl font-bold mb-6">スキルシート編集</h2>
        {localData && typeof localData === 'object' && Object.keys(localData).length > 0 ? (
          Object.keys(localData).map((careerKey, idx) => {
            const career = localData[careerKey];
            if (!career) return null;
            return (
              <div key={careerKey} className="mb-6 border-b pb-4">
                <h3 className="font-semibold mb-2">経歴{idx + 1}</h3>
                <div className="mb-2">
                  <label className="block text-sm font-medium">期間（from）</label>
                  <input
                    className="w-full border rounded px-2 py-1"
                    value={career.from || ''}
                    onChange={e => handleChange(careerKey, 'from', e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">期間（to）</label>
                  <input
                    className="w-full border rounded px-2 py-1"
                    value={career.to || ''}
                    onChange={e => handleChange(careerKey, 'to', e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">会社名</label>
                  <input
                    className="w-full border rounded px-2 py-1"
                    value={career['company name'] || ''}
                    onChange={e => handleChange(careerKey, 'company name', e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">雇用形態</label>
                  <input
                    className="w-full border rounded px-2 py-1"
                    value={career['employee type'] || ''}
                    onChange={e => handleChange(careerKey, 'employee type', e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">業務内容</label>
                  <textarea
                    className="w-full border rounded px-2 py-1"
                    value={career['work content'] || ''}
                    onChange={e => handleChange(careerKey, 'work content', e.target.value)}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div>経歴データがありません。</div>
        )}
        {/* Skills Edit Fields */}
        <div className="mb-6">
          <label className="block text-sm font-medium">語学力（カンマ区切りで入力）</label>
          <textarea
            className="w-full border rounded px-2 py-1"
            value={gogakuryoku}
            onChange={e => setGogakuryoku(e.target.value)}
            placeholder="例: 英語, TOEIC 750点"
          />
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium">資格（カンマ区切りで入力）</label>
          <textarea
            className="w-full border rounded px-2 py-1"
            value={shikaku}
            onChange={e => setShikaku(e.target.value)}
            placeholder="例: 普通自動車免許, 基本情報技術者"
          />
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium">スキル（カンマ区切りで入力）</label>
          <textarea
            className="w-full border rounded px-2 py-1"
            value={skillsList}
            onChange={e => setSkillsList(e.target.value)}
            placeholder="例: SAP, Excel, Word, Outlook, Teams"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="px-4 py-2 bg-gray-200 rounded" onClick={handleClose}>キャンセル</button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};

export default SkillSheetSidebar; 