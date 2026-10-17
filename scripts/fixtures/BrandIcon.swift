import AppKit
import ImageIO
import UniformTypeIdentifiers
let destination=CommandLine.arguments[1]
let size=1024
let ctx=CGContext(data:nil,width:size,height:size,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.translateBy(x:0,y:1024);ctx.scaleBy(x:1,y:-1)
let rounded=CGPath(roundedRect:CGRect(x:32,y:32,width:960,height:960),cornerWidth:216,cornerHeight:216,transform:nil)
ctx.addPath(rounded);ctx.clip()
let colors=[CGColor(red:0.078,green:0.376,blue:0.91,alpha:1),CGColor(red:0.027,green:0.114,blue:0.325,alpha:1)] as CFArray
let gradient=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:colors,locations:[0,1])!
ctx.drawLinearGradient(gradient,start:CGPoint(x:32,y:32),end:CGPoint(x:850,y:992),options:[])
let curve=CGMutablePath();curve.move(to:CGPoint(x:220,y:760));curve.addCurve(to:CGPoint(x:639,y:315),control1:CGPoint(x:795,y:900),control2:CGPoint(x:905,y:465))
ctx.addPath(curve);ctx.setStrokeColor(CGColor(red:0.384,green:0.796,blue:1,alpha:0.75));ctx.setLineWidth(36);ctx.setLineCap(.round);ctx.strokePath()
let arrow=CGMutablePath();arrow.move(to:CGPoint(x:285,y:212));for p in [CGPoint(x:738,y:535),CGPoint(x:528,y:562),CGPoint(x:430,y:790)]{arrow.addLine(to:p)};arrow.closeSubpath()
ctx.setShadow(offset:CGSize(width:0,height:18),blur:24,color:CGColor(red:0,green:0.05,blue:0.2,alpha:0.3));ctx.addPath(arrow);ctx.setFillColor(CGColor(gray:1,alpha:1));ctx.setStrokeColor(CGColor(red:0.777,green:0.918,blue:1,alpha:1));ctx.setLineWidth(9);ctx.setLineJoin(.round);ctx.drawPath(using:.fillStroke)
ctx.setShadow(offset:.zero,blur:0,color:nil)
let facet=CGMutablePath();facet.move(to:CGPoint(x:285,y:212));facet.addLine(to:CGPoint(x:528,y:562));facet.addLine(to:CGPoint(x:430,y:790));facet.closeSubpath();ctx.addPath(facet);ctx.setFillColor(CGColor(red:0.886,green:0.953,blue:1,alpha:1));ctx.fillPath()
let target=CGImageDestinationCreateWithURL(URL(fileURLWithPath:destination) as CFURL,UTType.png.identifier as CFString,1,nil)!
CGImageDestinationAddImage(target,ctx.makeImage()!,nil);if !CGImageDestinationFinalize(target){exit(1)}
