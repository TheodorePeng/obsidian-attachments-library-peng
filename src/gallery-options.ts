import { BasesAllOptions } from 'obsidian';
export function galleryViewOptions(): BasesAllOptions[] {
    return [
        { type: 'slider', key: 'cardSize', displayName: '卡片宽度', default: 240, min: 160, max: 480, step: 20 },
        { type: 'slider', key: 'cardGap', displayName: '卡片间距', default: 12, min: 0, max: 24, step: 2 },
        { type: 'slider', key: 'contentPadding', displayName: '内容边距', default: 8, min: 0, max: 24, step: 2 },
        { type: 'toggle', key: 'coverEnabled', displayName: '显示封面', default: true },
        { type: 'property', key: 'image', displayName: '封面属性', default: 'note.attachment' },
        { type: 'dropdown', key: 'imageFit', displayName: '图片适配', default: 'contain', options: { contain: '完整显示', cover: '铺满裁切' } },
        { type: 'dropdown', key: 'imageAspectRatio', displayName: '封面比例', default: '4:3', options: { '4:3': '4:3', '1:1': '1:1', '16:9': '16:9', '3:4': '3:4' } },
        { type: 'toggle', key: 'propertyLabels', displayName: '显示属性名称', default: true },
        { type: 'toggle', key: 'showEmptyProperties', displayName: '显示空属性', default: false },
        { type: 'slider', key: 'pageSize', displayName: '每页数量', default: 60, min: 1, max: 200, step: 1 },
    ];
}
