import { IUI, IApp } from '@leafer-ui/interface';

declare module '@leafer-ui/interface' {
    interface ILeafAttrData {
        isSnap?: boolean;
    }
}
type SnapConfig = {
    snapSize?: number;
    lineColor?: string;
    showLine?: boolean;
    strokeWidth?: number;
    dashPattern?: number[];
    isDash?: boolean;
    showLinePoints?: boolean;
    filter?: (element: IUI) => boolean;
};
declare class Snap {
    private app;
    private snapPoints;
    private verticalLines;
    private horizontalLines;
    private verticalLinePoints;
    private horizontalLinePoints;
    snapSize: number;
    lineColor: string;
    showLine: boolean;
    strokeWidth: number;
    isDash: boolean;
    dashPattern: number[];
    showLinePoints: boolean;
    filter?: (element: IUI) => boolean;
    constructor(app: IApp, config?: SnapConfig);
    changeFilter(filter: (element: IUI) => boolean): void;
    private isInRange;
    private handleMove;
    private drawLines;
    private getLinePoints;
    private drawPoints;
    private getLines;
    private drawLine;
    private handleSelect;
    private getSnapPoints;
    private getElementsInViewport;
    private clearLines;
    private clearPoints;
    private clear;
    enable(enable: boolean): void;
    destroy(): void;
}

export { Snap };
