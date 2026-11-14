import { BasesAllOptions } from 'obsidian';
export function galleryViewOptions(): BasesAllOptions[] {
    return [
        { type: 'slider', key: 'cardSize', displayName: 'Card width', default: 240, min: 160, max: 480, step: 20 },
        { type: 'slider', key: 'cardGap', displayName: 'Card gap', default: 12, min: 0, max: 24, step: 2 },
        { type: 'slider', key: 'contentPadding', displayName: 'Content padding', default: 8, min: 0, max: 24, step: 2 },
        { type: 'toggle', key: 'coverEnabled', displayName: 'Show cover', default: true },
        { type: 'property', key: 'image', displayName: 'Cover property', default: 'note.attachment' },
        { type: 'dropdown', key: 'imageFit', displayName: 'Image fit', default: 'contain', options: { contain: 'Contain', cover: 'Cover' } },
        { type: 'dropdown', key: 'imageAspectRatio', displayName: 'Cover aspect ratio', default: '4:3', options: { '4:3': '4:3', '1:1': '1:1', '16:9': '16:9', '3:4': '3:4' } },
        { type: 'toggle', key: 'propertyLabels', displayName: 'Show property names', default: true },
        { type: 'toggle', key: 'showEmptyProperties', displayName: 'Show empty properties', default: false },
        { type: 'slider', key: 'pageSize', displayName: 'Items per page', default: 60, min: 1, max: 200, step: 1 },
    ];
}
