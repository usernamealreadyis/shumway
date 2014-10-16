/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
module Shumway.Remoting.GFX {
  import Frame = Shumway.GFX.Frame;
  import BlurFilter = Shumway.GFX.BlurFilter;
  import DropshadowFilter = Shumway.GFX.DropshadowFilter;
  import FrameFlags = Shumway.GFX.FrameFlags;
  import Shape = Shumway.GFX.Shape;
  import Renderable = Shumway.GFX.Renderable;
  import RenderableShape = Shumway.GFX.RenderableShape;
  import RenderableBitmap = Shumway.GFX.RenderableBitmap;
  import RenderableVideo = Shumway.GFX.RenderableVideo;
  import RenderableText = Shumway.GFX.RenderableText;
  import ColorMatrix = Shumway.GFX.ColorMatrix;
  import FrameContainer = Shumway.GFX.FrameContainer;
  import ClipRectangle = Shumway.GFX.ClipRectangle;
  import ShapeData = Shumway.ShapeData;
  import DataBuffer = Shumway.ArrayUtilities.DataBuffer;
  import Stage = Shumway.GFX.Stage;

  import Smoothing = Shumway.GFX.Smoothing;
  import PixelSnapping = Shumway.GFX.PixelSnapping;

  import Point = Shumway.GFX.Geometry.Point;
  import Matrix = Shumway.GFX.Geometry.Matrix;
  import Rectangle = Shumway.GFX.Geometry.Rectangle;

  import IDataInput = Shumway.ArrayUtilities.IDataInput;
  import IDataOutput = Shumway.ArrayUtilities.IDataOutput;
  import assert = Shumway.Debug.assert;
  var writer = null; // release ? null : new IndentingWriter();

  declare var registerInspectorAsset;

  export class GFXChannelSerializer {
    public output: IDataOutput;
    public outputAssets: any [];

    public writeMouseEvent(event: MouseEvent, point: Point) {
      var output = this.output;
      output.writeInt(MessageTag.MouseEvent);
      var typeId = Shumway.Remoting.MouseEventNames.indexOf(event.type);
      output.writeInt(typeId);
      output.writeFloat(point.x);
      output.writeFloat(point.y);
      output.writeInt(event.buttons);
      var flags =
        (event.ctrlKey ? KeyboardEventFlags.CtrlKey : 0) |
        (event.altKey ? KeyboardEventFlags.AltKey : 0) |
        (event.shiftKey ? KeyboardEventFlags.ShiftKey : 0);
      output.writeInt(flags);
    }

    public writeKeyboardEvent(event: KeyboardEvent) {
      var output = this.output;
      output.writeInt(MessageTag.KeyboardEvent);
      var typeId = Shumway.Remoting.KeyboardEventNames.indexOf(event.type);
      output.writeInt(typeId);
      output.writeInt(event.keyCode);
      output.writeInt(event.charCode);
      output.writeInt(event.location);
      var flags =
        (event.ctrlKey ? KeyboardEventFlags.CtrlKey : 0) |
        (event.altKey ? KeyboardEventFlags.AltKey : 0) |
        (event.shiftKey ? KeyboardEventFlags.ShiftKey : 0);
      output.writeInt(flags);
    }

    public writeFocusEvent(type: FocusEventType) {
      var output = this.output;
      output.writeInt(MessageTag.FocusEvent);
      output.writeInt(type);
    }

    public writeDecodeImageResponse(promiseId: number, type: ImageType, data: Uint8Array, width: number, height: number) {
      var output = this.output;
      output.writeInt(MessageTag.DecodeImageResponse);
      output.writeInt(promiseId);
      output.writeInt(type);
      this._writeAsset(data);
      output.writeInt(width);
      output.writeInt(height);
    }

    private _writeAsset(asset: any) {
      this.output.writeInt(this.outputAssets.length);
      this.outputAssets.push(asset);
    }
  }

  export class GFXChannelDeserializerContext {
    root: ClipRectangle;
    _frames: Frame [];
    private _assets: Renderable [];

    _easelHost: Shumway.GFX.EaselHost;
    private _canvas: HTMLCanvasElement;
    private _context: CanvasRenderingContext2D;

    constructor(easelHost: Shumway.GFX.EaselHost, root: FrameContainer, transparent: boolean) {
      this.root = new ClipRectangle(128, 128);
      if (transparent) {
        this.root._setFlags(FrameFlags.Transparent);
      }
      root.addChild(this.root);
      this._frames = [];
      this._assets = [];

      this._easelHost = easelHost;
      this._canvas = document.createElement("canvas");
      this._context = this._canvas.getContext("2d");
    }

    _registerAsset(id: number, symbolId: number, asset: Renderable) {
      if (typeof registerInspectorAsset !== "undefined") {
        registerInspectorAsset(id, symbolId, asset);
      }
      this._assets[id] = asset;
    }

    _makeFrame(id: number): Frame {
      if (id === -1) {
        return null;
      }
      var frame = null;
      if (id & IDMask.Asset) {
        id &= ~IDMask.Asset;
        frame = new Shape(this._assets[id]);
        this._assets[id].addFrameReferrer(frame);
      } else {
        frame = this._frames[id];
      }
      release || assert (frame, "Frame " + frame + " of " + id + " has not been sent yet.");
      return frame;
    }

    _getAsset(id: number): Renderable {
      return this._assets[id];
    }

    _getBitmapAsset(id: number): RenderableBitmap {
      return <RenderableBitmap>this._assets[id];
    }

    _getVideoAsset(id: number): RenderableVideo {
      return <RenderableVideo>this._assets[id];
    }

    _getTextAsset(id: number): RenderableText {
      return <RenderableText>this._assets[id];
    }

    /**
     * Decodes some raw image data and calls |oncomplete| with the decoded pixel data
     * once the image is loaded.
     */
    _decodeImage(data: Uint8Array, oncomplete: (imageData: ImageData) => void) {
      var image = new Image();
      var self = this;
      image.src = URL.createObjectURL(new Blob([data]));
      image.onload = function () {
        self._canvas.width = image.width;
        self._canvas.height = image.height;
        self._context.drawImage(image, 0, 0);
        oncomplete(self._context.getImageData(0, 0, image.width, image.height));
      };
      image.onerror = function () {
        oncomplete(null);
      };
    }
  }

  export class GFXChannelDeserializer {
    input: IDataInput;
    inputAssets: any[];
    output: DataBuffer;
    context: GFXChannelDeserializerContext;

    /**
     * Used to avoid extra allocation, don't ever leak a reference to this object.
     */
    private static _temporaryReadMatrix: Matrix = Matrix.createIdentity();

    /**
     * Used to avoid extra allocation, don't ever leak a reference to this object.
     */
    private static _temporaryReadRectangle: Rectangle = Rectangle.createEmpty();

    /**
     * Used to avoid extra allocation, don't ever leak a reference to this object.
     */
    private static _temporaryReadColorMatrix: ColorMatrix = ColorMatrix.createIdentity();
    private static _temporaryReadColorMatrixIdentity: ColorMatrix = ColorMatrix.createIdentity();

    public read() {
      var tag = 0;
      var input = this.input;

      var data = {
        bytesAvailable: input.bytesAvailable,
        updateGraphics: 0,
        updateBitmapData: 0,
        updateTextContent: 0,
        updateFrame: 0,
        updateStage: 0,
        updateNetStream: 0,
        registerFont: 0,
        drawToBitmap: 0,
        decodeImage: 0
      };
      Shumway.GFX.enterTimeline("GFXChannelDeserializer.read", data);
      while (input.bytesAvailable > 0) {
        tag = input.readInt();
        switch (tag) {
          case MessageTag.EOF:
            Shumway.GFX.leaveTimeline("GFXChannelDeserializer.read");
            return;
          case MessageTag.UpdateGraphics:
            data.updateGraphics ++;
            this._readUpdateGraphics();
            break;
          case MessageTag.UpdateBitmapData:
            data.updateBitmapData ++;
            this._readUpdateBitmapData();
            break;
          case MessageTag.UpdateTextContent:
            data.updateTextContent ++;
            this._readUpdateTextContent();
            break;
          case MessageTag.UpdateFrame:
            data.updateFrame ++;
            this._readUpdateFrame();
            break;
          case MessageTag.UpdateStage:
            data.updateStage ++;
            this._readUpdateStage();
            break;
          case MessageTag.UpdateNetStream:
            data.updateNetStream ++;
            this._readUpdateNetStream();
            break;
          case MessageTag.RegisterFont:
            data.registerFont ++;
            this._readRegisterFont();
            break;
          case MessageTag.DrawToBitmap:
            data.drawToBitmap ++;
            this._readDrawToBitmap();
            break;
          case MessageTag.RequestBitmapData:
            data.drawToBitmap ++;
            this._readRequestBitmapData();
            break;
          case MessageTag.DecodeImage:
            data.decodeImage ++;
            this._readDecodeImage();
            break;
          default:
            release || assert(false, 'Unknown MessageReader tag: ' + tag);
            break;
        }
      }
      Shumway.GFX.leaveTimeline("GFXChannelDeserializer.read");
    }

    private _readMatrix(): Matrix {
      var input = this.input;
      var matrix = GFXChannelDeserializer._temporaryReadMatrix;
      matrix.setElements (
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
        input.readFloat() / 20,
        input.readFloat() / 20
      );
      return matrix;
    }

    private _readRectangle(): Rectangle {
      var input = this.input;
      var rectangle = GFXChannelDeserializer._temporaryReadRectangle;
      rectangle.setElements (
        input.readInt() / 20,
        input.readInt() / 20,
        input.readInt() / 20,
        input.readInt() / 20
      );
      return rectangle;
    }

    private _readColorMatrix(): ColorMatrix {
      var input = this.input;
      var colorMatrix = GFXChannelDeserializer._temporaryReadColorMatrix;
      var rm = 1, gm = 1, bm = 1, am = 1;
      var ro = 0, go = 0, bo = 0, ao = 0;
      switch (input.readInt()) {
        case ColorTransformEncoding.Identity:
          return GFXChannelDeserializer._temporaryReadColorMatrixIdentity;
          break;
        case ColorTransformEncoding.AlphaMultiplierOnly:
          am = input.readFloat();
          break;
        case ColorTransformEncoding.All:
          rm = input.readFloat();
          gm = input.readFloat();
          bm = input.readFloat();
          am = input.readFloat();
          ro = input.readInt();
          go = input.readInt();
          bo = input.readInt();
          ao = input.readInt();
          break;
      }
      colorMatrix.setMultipliersAndOffsets (
        rm, gm, bm, am,
        ro, go, bo, ao
      );
      return colorMatrix;
    }

    private _readAsset(): any {
      var assetId = this.input.readInt();
      var asset = this.inputAssets[assetId];
      this.inputAssets[assetId] = null;
      return asset;
    }

    private _readUpdateGraphics() {
      var input = this.input;
      var context = this.context;
      var id = input.readInt();
      var symbolId = input.readInt();
      var asset = <RenderableShape>context._getAsset(id);
      var bounds = this._readRectangle();
      var pathData = ShapeData.FromPlainObject(this._readAsset());
      var numTextures = input.readInt();
      var textures = [];
      for (var i = 0; i < numTextures; i++) {
        var bitmapId = input.readInt();
        textures.push(context._getBitmapAsset(bitmapId));
      }
      if (asset) {
        asset.update(pathData, textures, bounds);
      } else {
        var renderable = new RenderableShape(id, pathData, textures, bounds);
        for (var i = 0; i < textures.length; i++) {
          textures[i].addRenderableReferrer(renderable);
        }
        context._registerAsset(id, symbolId, renderable);
      }
    }

    private _readUpdateBitmapData() {
      var input = this.input;
      var context = this.context;
      var id = input.readInt();
      var symbolId = input.readInt();
      var asset = context._getBitmapAsset(id);
      var bounds = this._readRectangle();
      var type: ImageType = input.readInt();
      var dataBuffer = DataBuffer.FromPlainObject(this._readAsset());
      if (!asset) {
        asset = RenderableBitmap.FromDataBuffer(type, dataBuffer, bounds);
        context._registerAsset(id, symbolId, asset);
      } else {
        asset.updateFromDataBuffer(type, dataBuffer);
      }
      if (this.output) {
        // TODO: Write image data to output.
      }
    }

    private _readUpdateTextContent() {
      var input = this.input;
      var context = this.context;
      var id = input.readInt();
      var symbolId = input.readInt();
      var asset = context._getTextAsset(id);
      var bounds = this._readRectangle();
      var matrix = this._readMatrix();
      var backgroundColor = input.readInt();
      var borderColor = input.readInt();
      var autoSize = input.readInt();
      var wordWrap = input.readBoolean();
      var scrollV = input.readInt();
      var scrollH = input.readInt();
      var plainText = this._readAsset();
      var textRunData = DataBuffer.FromPlainObject(this._readAsset());
      var coords = null;
      var numCoords = input.readInt();
      if (numCoords) {
        coords = new DataBuffer(numCoords * 4);
        input.readBytes(coords, 0, numCoords * 4);
      }
      if (!asset) {
        asset = new RenderableText(bounds);
        asset.setContent(plainText, textRunData, matrix, coords);
        asset.setStyle(backgroundColor, borderColor, scrollV, scrollH);
        asset.reflow(autoSize, wordWrap);
        context._registerAsset(id, symbolId, asset);
      } else {
        asset.setBounds(bounds);
        asset.setContent(plainText, textRunData, matrix, coords);
        asset.setStyle(backgroundColor, borderColor, scrollV, scrollH);
        asset.reflow(autoSize, wordWrap);
      }
      if (this.output) {
        var rect = asset.textRect;
        this.output.writeInt(rect.w * 20);
        this.output.writeInt(rect.h * 20);
        this.output.writeInt(rect.x * 20);
        var lines = asset.lines;
        var numLines = lines.length;
        this.output.writeInt(numLines);
        for (var i = 0; i < numLines; i++) {
          this._writeLineMetrics(lines[i]);
        }
      }
    }

    private _writeLineMetrics(line: Shumway.GFX.TextLine): void {
      release || assert (this.output);
      this.output.writeInt(line.x);
      this.output.writeInt(line.width);
      this.output.writeInt(line.ascent);
      this.output.writeInt(line.descent);
      this.output.writeInt(line.leading);
    }

    private _readUpdateStage() {
      var context = this.context;
      var id = this.input.readInt();
      if (!context._frames[id]) {
        context._frames[id] = context.root;
      }
      var color = this.input.readInt();
      var rectangle = this._readRectangle()
      context.root.setBounds(rectangle);
      context.root.color = Color.FromARGB(color);
    }

    private _readUpdateNetStream() {
      var context = this.context;
      var id = this.input.readInt();
      var asset = context._getVideoAsset(id);
      var url = this.input.readUTF();
      if (!asset) {
        asset = new RenderableVideo(url, new Rectangle(0, 0, 960, 480));
        context._registerAsset(id, 0, asset);
      }
    }

    private _readFilters(frame: Frame) {
      var input = this.input;
      var count = input.readInt();
      var filters = [];
      if (count) {
        for (var i = 0; i < count; i++) {
          var type: FilterType = input.readInt();
          switch (type) {
            case FilterType.Blur:
              filters.push(new BlurFilter (
                input.readFloat(), // blurX
                input.readFloat(), // blurY
                input.readInt()    // quality
              ));
              break;
            case FilterType.DropShadow:
              filters.push(new DropshadowFilter (
                input.readFloat(),   // alpha
                input.readFloat(),   // angle
                input.readFloat(),   // blurX
                input.readFloat(),   // blurY
                input.readInt(),     // color
                input.readFloat(),   // distance
                input.readBoolean(), // hideObject
                input.readBoolean(), // inner
                input.readBoolean(), // knockout
                input.readInt(),     // quality
                input.readFloat()    // strength
              ));
              break;
            default:
              Shumway.Debug.somewhatImplemented(FilterType[type]);
              break;
          }
        }
      }
      frame.filters = filters;
    }

    private _readUpdateFrame() {
      var input = this.input;
      var context = this.context;
      var id = input.readInt();
      var ratio = 0;
      writer && writer.writeLn("Receiving UpdateFrame: " + id);
      var frame = context._frames[id];
      if (!frame) {
        frame = context._frames[id] = new FrameContainer();
      }
      var hasBits = input.readInt();
      if (hasBits & MessageBits.HasMatrix) {
        frame.matrix = this._readMatrix();
      }
      if (hasBits & MessageBits.HasColorTransform) {
        frame.colorMatrix = this._readColorMatrix();
      }
      if (hasBits & MessageBits.HasMask) {
        frame.mask = context._makeFrame(input.readInt());
      }
      if (hasBits & MessageBits.HasClip) {
        frame.clip = input.readInt();
      }
      if (hasBits & MessageBits.HasMiscellaneousProperties) {
        ratio = input.readInt() / 0xffff;
        frame.blendMode = input.readInt();
        this._readFilters(frame);
        frame._toggleFlags(FrameFlags.Visible, input.readBoolean());
        frame.pixelSnapping = <PixelSnapping>input.readInt();
        frame.smoothing = <Smoothing>input.readInt();
      }
      if (hasBits & MessageBits.HasChildren) {
        var count = input.readInt();
        var container = <FrameContainer>frame;
        container.clearChildren();
        for (var i = 0; i < count; i++) {
          var childId = input.readInt();
          var child = context._makeFrame(childId);
          release || assert (child, "Child " + childId + " of " + id + " has not been sent yet.");
          container.addChild(child);
        }
      }
      if (ratio) {
        var container = <FrameContainer>frame;
        var child = container._children[0];
        if (child instanceof Shape) {
          (<Shape>child).ratio = ratio;
        }
      }
    }

    private _readRegisterFont() {
      var input = this.input;
      var fontId = input.readInt();
      var bold = input.readBoolean();
      var italic = input.readBoolean();
      var data = this._readAsset();
      var head = document.head;
      head.insertBefore(document.createElement('style'), head.firstChild);
      var style = <CSSStyleSheet>document.styleSheets[0];
      style.insertRule(
        '@font-face{' +
        'font-family:swffont' + fontId + ';' +
        'src:url(data:font/opentype;base64,' + Shumway.StringUtilities.base64ArrayBuffer(data.buffer) + ')' +
        '}',
        style.cssRules.length
      );
    }

    private _readDrawToBitmap() {
      var input = this.input;
      var context = this.context;
      var targetId = input.readInt();
      var sourceId = input.readInt();
      var hasBits = input.readInt();
      var matrix;
      var colorMatrix;
      var clipRect;
      if (hasBits & MessageBits.HasMatrix) {
        matrix = this._readMatrix().clone();
      } else {
        matrix = Matrix.createIdentity();
      }
      if (hasBits & MessageBits.HasColorTransform) {
        colorMatrix = this._readColorMatrix();
      }
      if (hasBits & MessageBits.HasClipRect) {
        clipRect = this._readRectangle();
      }
      var blendMode = input.readInt();
      input.readBoolean(); // Smoothing
      var target = context._getBitmapAsset(targetId);
      var source = context._makeFrame(sourceId);
      if (!target) {
        context._registerAsset(targetId, -1, RenderableBitmap.FromFrame(source, matrix, colorMatrix, blendMode, clipRect));
      } else {
        target.drawFrame(source, matrix, colorMatrix, blendMode, clipRect);
      }
    }

    private _readRequestBitmapData() {
      var input = this.input;
      var output = this.output;
      var context = this.context;
      var id = input.readInt();
      var renderableBitmap = context._getBitmapAsset(id);
      renderableBitmap.readImageData(output);
    }

    private _readDecodeImage() {
      var input = this.input;
      var output = this.output;
      var context = this.context;
      var promiseId = input.readInt();
      var type = <ImageType>input.readInt();
      var data = this._readAsset();
      var self = this;
      this.context._decodeImage(data, function (imageData: ImageData) {
        var buffer = new DataBuffer();
        var serializer = new Shumway.Remoting.GFX.GFXChannelSerializer();
        var assets = [];
        serializer.output = buffer;
        serializer.outputAssets = assets;
        if (imageData) {
          serializer.writeDecodeImageResponse(promiseId, ImageType.StraightAlphaRGBA, imageData.data, imageData.width, imageData.height);
        } else {
          serializer.writeDecodeImageResponse(promiseId, ImageType.None, null, 0, 0);
        }
        self.context._easelHost.onSendUpdates(buffer, assets);
      });
    }
  }
}
