this.LeaferX = this.LeaferX || {};
this.LeaferX.snap = (function (exports, core, editor) {
    'use strict';

    const isArray = Array.isArray;
    core.UI.addAttr('isSnap', true, core.dataType);
    const DEFAULT_SNAP_SIZE = 10;
    const DEFAULT_LINE_COLOR = '#7F6EF6';
    class Snap {
        constructor(app, config) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            this.snapPoints = [];
            this.verticalLines = [];
            this.horizontalLines = [];
            this.verticalLinePoints = [];
            this.horizontalLinePoints = [];
            this.snapSize = DEFAULT_SNAP_SIZE;
            this.lineColor = DEFAULT_LINE_COLOR;
            this.showLine = true;
            this.strokeWidth = 1;
            this.isDash = true;
            this.dashPattern = [5];
            this.showLinePoints = true;
            if (!app.isApp) {
                throw new Error('target must be an App');
            }
            if (!app.tree) {
                throw new Error('tree layer is required');
            }
            if (!app.editor) {
                throw new Error('editor is required');
            }
            this.app = app;
            this.snapSize = (_a = config === null || config === void 0 ? void 0 : config.snapSize) !== null && _a !== void 0 ? _a : this.snapSize;
            this.lineColor = (_b = config === null || config === void 0 ? void 0 : config.lineColor) !== null && _b !== void 0 ? _b : this.lineColor;
            this.showLine = (_c = config === null || config === void 0 ? void 0 : config.showLine) !== null && _c !== void 0 ? _c : this.showLine;
            this.strokeWidth = (_d = config === null || config === void 0 ? void 0 : config.strokeWidth) !== null && _d !== void 0 ? _d : this.strokeWidth;
            this.isDash = (_e = config === null || config === void 0 ? void 0 : config.isDash) !== null && _e !== void 0 ? _e : this.isDash;
            this.dashPattern = (_f = config === null || config === void 0 ? void 0 : config.dashPattern) !== null && _f !== void 0 ? _f : this.dashPattern;
            this.showLinePoints = (_g = config === null || config === void 0 ? void 0 : config.showLinePoints) !== null && _g !== void 0 ? _g : this.showLinePoints;
            this.filter = (_h = config === null || config === void 0 ? void 0 : config.filter) !== null && _h !== void 0 ? _h : this.filter;
            this.handleMove = this.handleMove.bind(this);
            this.handleSelect = this.handleSelect.bind(this);
            this.clear = this.clear.bind(this);
        }
        changeFilter(filter) {
            this.filter = filter;
        }
        isInRange(value1, value2) {
            var _a;
            return (Math.abs(Math.round(value1) - Math.round(value2)) <=
                this.snapSize / ((_a = this.app.zoomLayer.scaleX) !== null && _a !== void 0 ? _a : 1));
        }
        handleMove(event) {
            this.clearLines();
            const { target } = event;
            const targetPoints = this.getSnapPoints(target);
            const snapX = [];
            const snapY = [];
            Object.keys(targetPoints).forEach(key => {
                const targetPoint = targetPoints[key];
                this.snapPoints.forEach(snapPoints => {
                    Object.keys(snapPoints).forEach(snapPointKey => {
                        const snapPoint = snapPoints[snapPointKey];
                        if (this.isInRange(targetPoint.x, snapPoint.x)) {
                            const offset = targetPoint.x - snapPoint.x;
                            snapX.push({
                                offset,
                                targetPoint,
                                snapPoint,
                            });
                        }
                        if (this.isInRange(targetPoint.y, snapPoint.y)) {
                            const offset = targetPoint.y - snapPoint.y;
                            snapY.push({
                                offset,
                                targetPoint,
                                snapPoint,
                            });
                        }
                    });
                });
            });
            const getSnapInfo = (snap) => {
                if (snap.length === 0) {
                    return null;
                }
                snap.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
                return snap[0];
            };
            const snapXInfo = getSnapInfo(snapX);
            const snapYInfo = getSnapInfo(snapY);
            if (snapXInfo) {
                if (this.app.editor.multiple) {
                    this.app.editor.list.forEach(item => {
                        item.x = item.x - snapXInfo.offset;
                    });
                    target.safeChange(() => {
                        target.x = target.x - snapXInfo.offset;
                    });
                }
                else {
                    target.x = target.x - snapXInfo.offset;
                }
            }
            if (snapYInfo) {
                if (this.app.editor.multiple) {
                    this.app.editor.list.forEach(item => {
                        item.y = item.y - snapYInfo.offset;
                    });
                    target.safeChange(() => {
                        target.y = target.y - snapYInfo.offset;
                    });
                }
                else {
                    target.y = target.y - snapYInfo.offset;
                }
            }
            if (!this.showLine) {
                return;
            }
            const verticalLines = snapX
                .filter(item => item.offset.toFixed(2) === (snapXInfo === null || snapXInfo === void 0 ? void 0 : snapXInfo.offset.toFixed(2)))
                .map(item => {
                var _a;
                return [
                    item.snapPoint.x,
                    item.snapPoint.y,
                    item.snapPoint.x,
                    item.targetPoint.y - ((_a = snapYInfo === null || snapYInfo === void 0 ? void 0 : snapYInfo.offset) !== null && _a !== void 0 ? _a : 0),
                ];
            });
            const horizontalLines = snapY
                .filter(item => item.offset.toFixed(2) === (snapYInfo === null || snapYInfo === void 0 ? void 0 : snapYInfo.offset.toFixed(2)))
                .map(item => {
                var _a;
                return [
                    item.snapPoint.x,
                    item.snapPoint.y,
                    item.targetPoint.x - ((_a = snapXInfo === null || snapXInfo === void 0 ? void 0 : snapXInfo.offset) !== null && _a !== void 0 ? _a : 0),
                    item.snapPoint.y,
                ];
            });
            this.drawLines(verticalLines, 'y', this.lineColor);
            this.drawLines(horizontalLines, 'x', this.lineColor);
        }
        drawLines(linesPoint, direction, color = this.lineColor) {
            const pointSet = new Set();
            linesPoint.forEach(line => {
                pointSet.add(direction === 'x' ? line[1] : line[0]);
            });
            const linesSet = Array.from(pointSet).map(point => linesPoint.filter(line => (direction === 'x' ? line[1] === point : line[0] === point)));
            const points = [];
            const shouldDrawLines = linesSet.map(lines => {
                let minPoint = Infinity;
                let maxPoint = -Infinity;
                lines.forEach(line => {
                    points.push([line[0], line[1]], [line[2], line[3]]);
                    if (direction === 'x') {
                        minPoint = Math.min(minPoint, line[0], line[2]);
                        maxPoint = Math.max(maxPoint, line[0], line[2]);
                    }
                    else {
                        minPoint = Math.min(minPoint, line[1], line[3]);
                        maxPoint = Math.max(maxPoint, line[1], line[3]);
                    }
                });
                const constantNum = direction === 'x' ? lines[0][1] : lines[0][0];
                if (direction === 'x') {
                    return [minPoint, constantNum, maxPoint, constantNum];
                }
                return [constantNum, minPoint, constantNum, maxPoint];
            });
            if (this.showLinePoints) {
                this.drawPoints(points, direction);
            }
            const lines = this.getLines(shouldDrawLines.length, direction);
            shouldDrawLines.forEach((line, index) => {
                this.drawLine(lines[index], line, color);
            });
        }
        getLinePoints(points, direction) {
            var _a;
            const linePoints = direction === 'x' ? this.horizontalLinePoints : this.verticalLinePoints;
            const originLinePointsNum = linePoints.length;
            if (points.length <= originLinePointsNum) {
                return linePoints.slice(0, points.length);
            }
            const newLinePoints = new Array(points.length - originLinePointsNum).fill(null).map(() => {
                const line1 = new core.Line({
                    stroke: this.lineColor,
                    strokeWidth: this.strokeWidth,
                    points: [0, 0, 6, 6],
                    className: 'point-line',
                });
                const line2 = new core.Line({
                    stroke: this.lineColor,
                    strokeWidth: this.strokeWidth,
                    points: [0, 6, 6, 0],
                    className: 'point-line',
                });
                const points = new core.Group({
                    className: 'linePoint',
                    children: [line1, line2],
                    around: 'center',
                    visible: false,
                });
                return points;
            });
            linePoints.push(...newLinePoints);
            (_a = this.app.sky) === null || _a === void 0 ? void 0 : _a.add(newLinePoints);
            return [...linePoints, ...newLinePoints];
        }
        drawPoints(points, direction) {
            const linePoints = this.getLinePoints(points, direction);
            points.forEach((point, index) => {
                var _a, _b;
                const worldPoint = (_a = this.app.tree) === null || _a === void 0 ? void 0 : _a.getWorldPoint({
                    x: point[0],
                    y: point[1],
                });
                const points = linePoints[index];
                points.set({
                    visible: true,
                    x: worldPoint.x,
                    y: worldPoint.y,
                });
                points.children.forEach(item => {
                    item.stroke = this.lineColor;
                });
                (_b = this.app.sky) === null || _b === void 0 ? void 0 : _b.add(points);
            });
        }
        getLines(number, direction) {
            var _a;
            const lines = direction === 'x' ? this.horizontalLines : this.verticalLines;
            const originLineNum = lines.length;
            if (number <= originLineNum) {
                return lines.slice(0, number);
            }
            else {
                const newLines = new Array(number - originLineNum).fill(null).map(() => new core.Line({
                    stroke: this.lineColor,
                    strokeWidth: this.strokeWidth,
                    className: `snap-line-${direction}`,
                    visible: false,
                    dashPattern: this.isDash ? this.dashPattern : undefined,
                }));
                lines.push(...newLines);
                (_a = this.app.sky) === null || _a === void 0 ? void 0 : _a.add(newLines);
                return [...lines, ...newLines];
            }
        }
        drawLine(line, linePoint, color = this.lineColor) {
            var _a, _b;
            const firstPoint = (_a = this.app.tree) === null || _a === void 0 ? void 0 : _a.getWorldPoint({
                x: linePoint[0],
                y: linePoint[1],
            });
            const secondPoint = (_b = this.app.tree) === null || _b === void 0 ? void 0 : _b.getWorldPoint({
                x: linePoint[2],
                y: linePoint[3],
            });
            line.set({
                points: [firstPoint.x, firstPoint.y, secondPoint.x, secondPoint.y],
                visible: true,
                stroke: color,
                strokeWidth: this.strokeWidth,
                dashPattern: this.isDash ? this.dashPattern : undefined,
            });
        }
        handleSelect(event) {
            const { value: selectElements } = event;
            const elements = this.getElementsInViewport().filter(item => {
                if (item === selectElements) {
                    return false;
                }
                if (isArray(selectElements)) {
                    if (selectElements.includes(item) ||
                        selectElements.some(el => { var _a; return (_a = item.children) === null || _a === void 0 ? void 0 : _a.includes(el); })) {
                        return false;
                    }
                }
                if (!item.isSnap) {
                    return false;
                }
                if (this.filter) {
                    return this.filter(item);
                }
                return true;
            });
            this.snapPoints = elements.map(item => this.getSnapPoints(item));
        }
        getSnapPoints(_element) {
            let element = [];
            if (Array.isArray(_element)) {
                element = [..._element];
                let maxX = -Infinity;
                let maxY = -Infinity;
                let minX = Infinity;
                let minY = Infinity;
                element.forEach(item => {
                    const points = item.getLayoutPoints('box', this.app.tree);
                    maxX = Math.max(maxX, ...points.map(item => item.x));
                    maxY = Math.max(maxY, ...points.map(item => item.y));
                    minX = Math.min(minX, ...points.map(item => item.x));
                    minY = Math.min(minY, ...points.map(item => item.y));
                });
                return {
                    tl: {
                        x: minX,
                        y: minY,
                    },
                    tr: {
                        x: maxX,
                        y: minY,
                    },
                    bl: {
                        x: minX,
                        y: maxY,
                    },
                    br: {
                        x: maxX,
                        y: maxY,
                    },
                    c: {
                        x: (minX + maxX) / 2,
                        y: (minY + maxY) / 2,
                    },
                };
            }
            else {
                const points = _element.getLayoutPoints('box', this.app.tree);
                const maxX = Math.max(...points.map(item => item.x));
                const maxY = Math.max(...points.map(item => item.y));
                const minX = Math.min(...points.map(item => item.x));
                const minY = Math.min(...points.map(item => item.y));
                const centerPoint = {
                    x: (maxX + minX) / 2,
                    y: (maxY + minY) / 2,
                };
                return {
                    tl: points[0],
                    tr: points[1],
                    bl: points[2],
                    br: points[3],
                    c: centerPoint,
                };
            }
        }
        getElementsInViewport() {
            var _a, _b;
            const zoomLayer = this.app.zoomLayer;
            const viewportBounds = [
                -zoomLayer.x,
                -zoomLayer.y,
                -zoomLayer.x + zoomLayer.width / zoomLayer.scaleX,
                -zoomLayer.y + zoomLayer.height / zoomLayer.scaleY,
            ];
            const data = (_b = (_a = this.app.tree) === null || _a === void 0 ? void 0 : _a.children) === null || _b === void 0 ? void 0 : _b.filter(item => {
                if (item.isLeafer || item.tag === 'SimulateElement') {
                    return false;
                }
                const itemBounds = item.getLayoutBounds('box', this.app.tree);
                if (itemBounds.x > viewportBounds[2] ||
                    itemBounds.y > viewportBounds[3] ||
                    itemBounds.x + itemBounds.width < viewportBounds[0] ||
                    itemBounds.y + itemBounds.height < viewportBounds[1]) {
                    return false;
                }
                return true;
            });
            return data !== null && data !== void 0 ? data : [];
        }
        clearLines(direction) {
            let lines = [];
            if (direction) {
                lines = direction === 'x' ? this.horizontalLines : this.verticalLines;
            }
            else {
                lines = [...this.horizontalLines, ...this.verticalLines];
            }
            lines === null || lines === void 0 ? void 0 : lines.forEach(line => {
                line.visible = false;
            });
        }
        clearPoints(direction) {
            if (!direction) {
                this.horizontalLinePoints.forEach(item => {
                    item.visible = false;
                });
                this.verticalLinePoints.forEach(item => {
                    item.visible = false;
                });
                return;
            }
            const linePoints = direction === 'x' ? this.horizontalLinePoints : this.verticalLinePoints;
            linePoints.forEach(item => {
                item.visible = false;
            });
        }
        clear() {
            this.clearLines();
            if (this.showLinePoints) {
                this.clearPoints();
            }
        }
        enable(enable) {
            var _a, _b, _c, _d, _e, _f, _g;
            if (enable) {
                (_a = this.app.editor) === null || _a === void 0 ? void 0 : _a.on(editor.EditorEvent.SELECT, this.handleSelect);
                (_b = this.app.editor) === null || _b === void 0 ? void 0 : _b.on(editor.EditorMoveEvent.MOVE, this.handleMove);
                this.app.on(core.PointerEvent.UP, this.clear);
                (_c = this.app.tree) === null || _c === void 0 ? void 0 : _c.on(core.LayoutEvent.AFTER, this.clear);
                const selectElements = (_d = this.app.editor) === null || _d === void 0 ? void 0 : _d.list;
                if (selectElements.length > 0) {
                    this.handleSelect({
                        value: selectElements,
                    });
                }
            }
            else {
                (_e = this.app.editor) === null || _e === void 0 ? void 0 : _e.off(editor.EditorEvent.SELECT, this.handleSelect);
                (_f = this.app.editor) === null || _f === void 0 ? void 0 : _f.off(editor.EditorMoveEvent.MOVE, this.handleMove);
                this.app.off(core.PointerEvent.UP, this.clear);
                (_g = this.app.tree) === null || _g === void 0 ? void 0 : _g.off(core.LayoutEvent.AFTER, this.clear);
            }
        }
        destroy() {
            var _a, _b, _c;
            (_a = this.app.editor) === null || _a === void 0 ? void 0 : _a.off(editor.EditorEvent.SELECT, this.handleSelect);
            (_b = this.app.editor) === null || _b === void 0 ? void 0 : _b.off(editor.EditorMoveEvent.MOVE, this.handleMove);
            this.app.off(core.PointerEvent.UP, this.clear);
            (_c = this.app.tree) === null || _c === void 0 ? void 0 : _c.off(core.LayoutEvent.AFTER, this.clear);
            this.clear();
            this.horizontalLines.forEach(line => {
                line.destroy();
            });
            this.verticalLines.forEach(line => {
                line.destroy();
            });
            this.verticalLinePoints.forEach(item => {
                item.destroy();
            });
            this.horizontalLinePoints.forEach(item => {
                item.destroy();
            });
            this.verticalLinePoints = [];
            this.horizontalLinePoints = [];
            this.horizontalLines = [];
            this.verticalLines = [];
        }
    }

    exports.Snap = Snap;

    return exports;

})({}, LeaferUI, LeaferUI);
