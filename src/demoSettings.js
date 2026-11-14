export const defaults = { theme: 'dark', accent: 'Monochrome', scale: 100, compact: false }

export const groups = [
  {
    id: 'appearance', label: 'Appearance', sections: [
      { title: 'Theme', description: 'Choose how WinOpti looks on this device.', fields: [{
        id: 'theme', label: 'Color mode', type: 'radio',
        options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }],
      }] },
      { title: 'Interface', fields: [
        { id: 'accent', label: 'Accent color', type: 'select', options: ['Monochrome', 'Teal', 'Blue', 'Violet', 'Rose'].map(value => ({ value, label: value })) },
        { id: 'scale', label: 'Text size', type: 'range', min: 90, max: 125, step: 5, formatValue: value => `${value}%` },
        { id: 'compact', label: 'Compact layout', description: 'Reduce spacing between settings.', type: 'switch' },
      ] },
    ],
  },
  { id: 'protection', label: 'App protection', sections: [] },
  { id: 'updates', label: 'Updates', sections: [] },
]
