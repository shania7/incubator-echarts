define(function(require) {

    var DataRangeView = require('./DataRangeView');
    var graphic = require('../../util/graphic');
    var zrUtil = require('zrender/core/util');
    var numberUtil = require('../../util/number');
    var modelUtil = require('../../util/model');
    var linearMap = numberUtil.linearMap;
    var LinearGradient = require('zrender/graphic/LinearGradient');
    var each = zrUtil.each;

    // Notice:
    // Any "interval" should be by the order of [low, high].
    // "handle0" (handleIndex === 0) maps to
    // low data value: this._dataInterval[0] and has low coord.
    // "handle1" (handleIndex === 1) maps to
    // high data value: this._dataInterval[1] and has high coord.
    // The logic of transform is implemented in this._createBarGroup.

    var PiecewiseDataRangeView = DataRangeView.extend({

        type: 'dataRange.continuous',

        /**
         * @override
         */
        init: function () {

            DataRangeView.prototype.init.apply(this, arguments);

            /**
             * @private
             */
            this._shapes = {};

            /**
             * @private
             */
            this._dataInterval = [];

            /**
             * @private
             */
            this._handleEnds = [];

            /**
             * @private
             */
            this._orient;

            /**
             * @private
             */
            this._useHandle;
        },

        /**
         * @protected
         * @override
         */
        doRender: function (dataRangeModel, ecModel, api, event) {
            if (!event || event.type !== 'dataRangeSelected' || event.from !== this.uid) {
                this._buildView();
            }
            else {
                this._updateView();
            }
        },

        /**
         * @private
         */
        _buildView: function () {
            this.group.removeAll();

            var dataRangeModel = this.dataRangeModel;
            var thisGroup = this.group;

            this._orient = dataRangeModel.get('orient');
            this._useHandle = dataRangeModel.get('calculable');

            this._resetInterval();

            this._renderBar(thisGroup);

            var dataRangeText = dataRangeModel.get('text');
            dataRangeText && this._renderEndsText(thisGroup, dataRangeText, 0);
            dataRangeText && this._renderEndsText(thisGroup, dataRangeText, 1);

            // After updating view, inner shapes is built completely,
            // and then background can be rendered.
            this._updateView();

            this.renderBackground(thisGroup);

            this.positionGroup(thisGroup);
        },

        /**
         * @private
         */
        _renderEndsText: function (group, dataRangeText, endsIndex) {
            var text = dataRangeText[endsIndex];
            text = text != null ? text + '' : '';

            var dataRangeModel = this.dataRangeModel;
            var textGap = dataRangeModel.get('textGap');
            var itemSize = dataRangeModel.itemSize;

            var barGroup = this._shapes.barGroup;
            var position = this._applyTransform(
                [
                    itemSize[0] / 2,
                    endsIndex === 0 ? -textGap : itemSize[1] + textGap
                ],
                barGroup
            );
            var align = this._applyTransform(
                endsIndex === 0 ? 'bottom' : 'top',
                barGroup
            );
            var orient = this._orient;

            this.group.add(new graphic.Text({
                style: {
                    x: position[0],
                    y: position[1],
                    textBaseline: orient === 'horizontal' ? 'middle' : align,
                    textAlign: orient === 'horizontal' ? align : 'center',
                    text: text,
                    font: this.dataRangeModel.textStyleModel.getFont()
                }
            }));
        },

        /**
         * @private
         */
        _renderBar: function (targetGroup) {
            var dataRangeModel = this.dataRangeModel;
            var shapes = this._shapes;
            var itemSize = dataRangeModel.itemSize;
            var api = this.api;
            var orient = this._orient;
            var useHandle = this._useHandle;

            var itemAlign = this.getItemAlignByOrient(
                orient === 'horizontal' ? 'vertical' : 'horizontal',
                orient === 'horizontal' ? api.getWidth() : api.getHeight()
            );

            var barGroup = shapes.barGroup = this._createBarGroup(itemAlign);

            // Bar
            barGroup.add(shapes.outOfRange = createPolygon());
            barGroup.add(shapes.inRange = createPolygon(
                null,
                zrUtil.bind(this._modifyHandle, this, 'all'),
                useHandle ? 'move' : null
            ));

            var textRect = dataRangeModel.textStyleModel.getTextRect('国');
            var textSize = Math.max(textRect.width, textRect.height);

            // Handle
            if (useHandle) {
                var handleEndsMax = [0, itemSize[1]];

                shapes.handleGroups = [];
                shapes.handleThumbs = [];
                shapes.handleLabels = [];
                shapes.handleLabelPoints = [];

                this._createHandle(barGroup, 0, itemSize, textSize, orient, itemAlign);
                this._createHandle(barGroup, 1, itemSize, textSize, orient, itemAlign);

                // Do this for background size calculation.
                this._updateHandlePosition(handleEndsMax);
            }

            // Indicator
            // FIXME

            targetGroup.add(barGroup);
        },

        /**
         * @private
         */
        _createHandle: function (barGroup, handleIndex, itemSize, textSize, orient, itemAlign) {
            var handleGroup = new graphic.Group({position: [itemSize[0], 0]});
            var handleThumb = createPolygon(
                createHandlePoints(handleIndex, textSize),
                zrUtil.bind(this._modifyHandle, this, handleIndex),
                'move'
            );
            handleGroup.add(handleThumb);

            // For text locating. Text is always horizontal layout
            // but should not be effected by transform.
            var handleLabelPoint = {
                x: orient === 'horizontal'
                    ? textSize / 2
                    : textSize + 3,
                y: orient === 'horizontal'
                    ? (handleIndex === 0 ? -textSize - 3 : textSize + 3)
                    : (handleIndex === 0 ? -textSize / 2 : textSize / 2)
            };

            var handleLabel = new graphic.Text({
                silent: true,
                style: {
                    x: 0, y: 0, text: '',
                    textBaseline: 'middle',
                    font: this.dataRangeModel.textStyleModel.getFont()
                }
            });

            this.group.add(handleLabel); // Text do not transform

            var shapes = this._shapes;
            shapes.handleThumbs[handleIndex] = handleThumb;
            shapes.handleGroups[handleIndex] = handleGroup;
            shapes.handleLabelPoints[handleIndex] = handleLabelPoint;
            shapes.handleLabels[handleIndex] = handleLabel;

            barGroup.add(handleGroup);
        },

        /**
         * @private
         */
        _modifyHandle: function (handleIndex, dx, dy) {
            if (!this._useHandle) {
                return;
            }

            // Transform dx, dy to bar coordination.
            var vertex = this._applyTransform([dx, dy], this._shapes.barGroup, true);
            this._updateInterval(handleIndex, vertex[1]);

            this.api.dispatch({
                type: 'selectDataRange',
                from: this.uid,
                dataRangeModelId: this.dataRangeModel.uid,
                selected: this._dataInterval.slice()
            });
        },

        /**
         * @private
         */
        _resetInterval: function () {
            var dataRangeModel = this.dataRangeModel;

            var dataInterval = this._dataInterval = dataRangeModel.getSelected();

            this._handleEnds = linearMap(
                dataInterval,
                dataRangeModel.getExtent(),
                [0, dataRangeModel.itemSize[1]],
                true
            );
        },

        /**
         * @private
         * @param {(number|string)} handleIndex 0 or 1 or 'all'
         * @param {number} dx
         * @param {number} dy
         */
        _updateInterval: function (handleIndex, delta) {
            delta = delta || 0;
            var dataRangeModel = this.dataRangeModel;
            var handleEnds = this._handleEnds;
            var extent = [0, dataRangeModel.itemSize[1]];

            if (handleIndex === 'all') {
                delta = getRealDelta(delta, handleEnds, extent);
                handleEnds[0] += delta;
                handleEnds[1] += delta;
            }
            else {
                delta = getRealDelta(delta, handleEnds[handleIndex], extent);
                handleEnds[handleIndex] += delta;

                if (handleEnds[0] > handleEnds[1]) {
                    handleEnds[1 - handleIndex] = handleEnds[handleIndex];
                }
            }

            // Update data interval.
            this._dataInterval = linearMap(
                handleEnds,
                [0, dataRangeModel.itemSize[1]],
                dataRangeModel.getExtent(),
                true
            );

            function getRealDelta(delta, handleEnds, extent) {
                !handleEnds.length && (handleEnds = [handleEnds, handleEnds]);

                if (delta < 0 && handleEnds[0] + delta < extent[0]) {
                    delta = extent[0] - handleEnds[0];
                }
                if (delta > 0 && handleEnds[1] + delta > extent[1]) {
                    delta = extent[1] - handleEnds[1];
                }
                return delta;
            }
        },

        /**
         * @private
         */
        _updateView: function () {
            var dataRangeModel = this.dataRangeModel;
            var dataExtent = dataRangeModel.getExtent();
            var shapes = this._shapes;
            var dataInterval = this._dataInterval;

            var visualInRange = this._createBarVisual(dataInterval, dataExtent);
            var visualOutOfRange = this._createBarVisual(dataExtent, dataExtent, 'outOfRange');

            shapes.inRange
                .setStyle('fill', visualInRange.barColor)
                .setShape('points', visualInRange.barPoints);
            shapes.outOfRange
                .setStyle('fill', visualOutOfRange.barColor)
                .setShape('points', visualOutOfRange.barPoints);

            this._useHandle && each([0, 1], function (handleIndex) {

                shapes.handleThumbs[handleIndex].setStyle(
                    'fill', visualInRange.handlesColor[handleIndex]
                );

                shapes.handleLabels[handleIndex].setStyle({
                    text: dataRangeModel.formatValueText(dataInterval[handleIndex]),
                    textAlign: this._applyTransform(
                        this._orient === 'horizontal'
                            ? (handleIndex === 0 ? 'bottom' : 'top')
                            : 'left',
                        shapes.barGroup
                    )
                });

            }, this);

            this._updateHandlePosition(visualInRange.handleEnds);
        },

        /**
         * @private
         */
        _createBarVisual: function (dataInterval, dataExtent, forceState) {
            var handleEnds = forceState
                ? [0, this.dataRangeModel.itemSize[1]]
                : this._handleEnds;

            var visuals = [
                this.getControllerVisual(dataInterval[0], forceState),
                this.getControllerVisual(dataInterval[1], forceState)
            ];

            var colorStops = [];
            var handles = [];
            each(dataInterval, function (value, index) {
                colorStops.push({offset: index, color: visuals[index].color});
                handles.push(visuals[index].color);
            });

            var barPoints = this._createBarPoints(handleEnds, visuals);

            return {
                barColor: new LinearGradient(0, 0, 1, 1, colorStops),
                barPoints: barPoints,
                handlesColor: handles,
                handleEnds: handleEnds
            };
        },

        /**
         * @private
         */
        _createBarPoints: function (handleEnds, visuals) {
            var itemSize = this.dataRangeModel.itemSize;
            var widths0 = visuals[0].symbolSize;
            var widths1 = visuals[1].symbolSize;

            return [
                [itemSize[0] - widths0, handleEnds[0]],
                [itemSize[0], handleEnds[0]],
                [itemSize[0], handleEnds[1]],
                [itemSize[0] - widths1, handleEnds[1]]
            ];
        },

        /**
         * @private
         */
        _createBarGroup: function (itemAlign) {
            var orient = this._orient;
            var inverse = this.dataRangeModel.get('inverse');

            return new graphic.Group(
                (orient === 'horizontal' && !inverse)
                ? {scale: itemAlign === 'top' ? [1, 1] : [-1, 1], rotation: Math.PI / 2}
                : (orient === 'horizontal' && inverse)
                ? {scale: itemAlign === 'top' ? [-1, 1] : [1, 1], rotation: -Math.PI / 2}
                : (orient === 'vertical' && !inverse)
                ? {scale: itemAlign === 'right' ? [1, -1] : [-1, -1]}
                : {scale: itemAlign === 'right' ? [1, 1] : [-1, 1]}
            );
        },

        /**
         * @private
         */
        _updateHandlePosition: function (handleEnds) {
            if (!this._useHandle) {
                return;
            }

            var shapes = this._shapes;

            each([0, 1], function (handleIndex) {
                var handleGroup = shapes.handleGroups[handleIndex];
                handleGroup.position[1] = handleEnds[handleIndex];

                // Update handle label location
                var labelPoint = shapes.handleLabelPoints[handleIndex];
                var textPoint = modelUtil.applyTransform(
                    [labelPoint.x, labelPoint.y],
                    modelUtil.getTransform(handleGroup, this.group)
                );

                shapes.handleLabels[handleIndex].setStyle({
                    x: textPoint[0], y: textPoint[1]
                });
            }, this);
        },

        /**
         * @private
         */
        _applyTransform: function (vertex, element, inverse) {
            var transform = modelUtil.getTransform(element, this.group);

            return modelUtil[
                zrUtil.isArray(vertex)
                    ? 'applyTransform' : 'transformDirection'
            ](vertex, transform, inverse);
        }

    });

    function createPolygon(points, onDrift, cursor) {
        return new graphic.Polygon({
            shape: {points: points},
            draggable: !!onDrift,
            cursor: cursor,
            drift: onDrift
        });
    }

    function createHandlePoints(handleIndex, textSize) {
        return handleIndex === 0
            ? [[0, 0], [textSize, 0], [textSize, -textSize]]
            : [[0, 0], [textSize, 0], [textSize, textSize]];
    }

    return PiecewiseDataRangeView;
});
