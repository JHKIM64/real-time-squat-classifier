import styled from "styled-components";
import React from "react";
import { useEffect, useRef, useState } from "react";

import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { Pose, Results, VERSION, POSE_CONNECTIONS } from "@mediapipe/pose";
import { calculateDistanceMatrix } from "./utils/Calculator";
import { mediaPipeConverter } from "./utils/Converter";
import { angleCalc } from "./utils/Angle";

import { Matrix } from "ml-matrix";
import ResNet from "../TFModel/classifier";
import * as tf from "@tensorflow/tfjs";

const Loading = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
  background-color: rgba(0, 0, 0, 0.5);
  width: 100%;
  height: 100%;
  color: white;
`;

const PoseContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  border-radius: 20px;
  background-color: #1e1b1e;
  overflow: clip;
`;

interface MediaPipeProps {
  increaseSquatCount: () => void;
}

const MediaPipe = ({ increaseSquatCount }: MediaPipeProps) => {
  const [inputVideoReady, setInputVideoReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const inputVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);

  const [frame, setFrame] = useState<number[][]>([]);
  const [tempFrame, setTempFrame] = useState<number[]>([]);

  const [angle, setAngle] = useState<number[]>([]);
  const [tempAngle, setTempAngle] = useState<number>(0);

  const [init, setInit] = useState<boolean>(false);
  const [countFrame, setCountFrame] = useState<number>(0);
  const [prevCount, setPrevCount] = useState<boolean>(false);

  const [inputData, setInputData] = useState<number[][]>([]);

  useEffect(() => {
    if (!inputVideoReady) {
      return;
    }
    if (inputVideoRef.current && canvasRef.current) {
      console.log("rendering");
      contextRef.current = canvasRef.current.getContext("2d");
      const constraints = {
        video: { width: { min: 1280 }, height: { min: 720 } },
      };
      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        if (inputVideoRef.current) {
          inputVideoRef.current.srcObject = stream;
        }
        sendToMediaPipe();
      });

      const pose = new Pose({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${VERSION}/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults(onResults);

      const sendToMediaPipe = async () => {
        if (inputVideoRef.current) {
          if (!inputVideoRef.current.videoWidth) {
            console.log(inputVideoRef.current.videoWidth);
            requestAnimationFrame(sendToMediaPipe);
          } else {
            await pose.send({ image: inputVideoRef.current });
            requestAnimationFrame(sendToMediaPipe);
          }
        }
      };
    }
  }, [inputVideoReady]);

  const onResults = (results: Results) => {
    if (canvasRef.current && contextRef.current) {
      setLoaded(true);

      contextRef.current.save();
      contextRef.current.clearRect(
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );
      contextRef.current.drawImage(
        results.image,
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );

      if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        drawConnectors(contextRef.current, landmarks, POSE_CONNECTIONS, {
          color: "#9bb2da",
          lineWidth: 4,
        });
        drawLandmarks(contextRef.current, landmarks, {
          color: "#fe6d79",
          lineWidth: 2,
        });

        const matrix = new Matrix(
          calculateDistanceMatrix(mediaPipeConverter(landmarks))
        )
          .to2DArray()
          .map((row, i) => row.slice(i + 1))
          .flat();
        // const max = Math.max(...matrix);
        // const min = Math.min(...matrix);
        // const normalizedMatrix = matrix.map((value) => {
        //   return (value - min) / (max - min);
        // });
        const angleOfFrame = angleCalc(landmarks);
        setTempFrame(matrix);
        setTempAngle(angleOfFrame);
      }
      contextRef.current.restore();
    }
  };

  useEffect(() => {
    // stack frame
    if (tempFrame.length > 0) {
      setFrame((prevFrame) => [...prevFrame, tempFrame].slice(-100));
    }
    // stack angle
    if (tempAngle) {
      setAngle((prevAngle) => [...prevAngle, tempAngle].slice(-100));
    }

    if (angle.length > 19) {
      const lastTenAngles = angle.slice(-20);
      const tenFrameUnder = lastTenAngles.every((angle) => angle > -0.7);
      const lastFiveFalse = lastTenAngles.map((angle) => angle > -0.7);
      const toEnd = lastFiveFalse.every((angle) => angle === false);

      setInit(tenFrameUnder);
      if (tenFrameUnder || !toEnd) {
        setPrevCount(true);
        if (countFrame === 0) {
          setInputData([...inputData, ...frame.slice(-20)]);
        }
        setCountFrame((prevCount) => prevCount + 1);
        if (countFrame === 19) {
          setCountFrame(0);
        }
      } else {
        if (prevCount) {
          increaseSquatCount();
          /*
          model processing
          */
          const model = ResNet();
          const inputTemp = tf.tensor(inputData) as tf.Tensor2D;
          const repeatedData = tf
            .tile(inputTemp, [1, Math.floor(300 / inputData.length)])
            .reshape([171, -1, 1]) as tf.Tensor3D;
          const resizedData = tf.image.resizeBilinear(repeatedData, [171, 300]);
          const modelInput = resizedData.reshape([1, 171, 300, 1]);
          const prediction = model.predict(modelInput) as tf.Tensor2D;
          console.log(prediction.toString());
          setPrevCount(false);
        }
        setInputData([]);
      }
    }
  }, [tempFrame]);

  useEffect(() => {
    const model = ResNet();
    const randomData = tf.randomNormal([171, 80, 1]);
    const repeatedData = tf.tile(randomData, [1, 3, 1]) as tf.Tensor3D;
    const inputDataTemp1 = tf.image.resizeBilinear(repeatedData, [171, 300]);
    const inputDataTemp = inputDataTemp1.reshape([1, 171, 300, 1]);

    const prediction = model.predict(inputDataTemp);
    console.log("sample prediction", prediction.toString());
  }, []);

  return (
    <PoseContainer>
      <video
        autoPlay
        ref={(el) => {
          inputVideoRef.current = el;
          setInputVideoReady(!!el);
        }}
        style={{
          display: "none",
          transform: "rotateY(180deg)",
          WebkitTransition: "rotateY(180deg)",
        }}
      />
      <canvas
        ref={canvasRef}
        width={canvasRef.current?.width || 1152}
        height={canvasRef.current?.height || 648}
        style={{
          transform: "rotateY(180deg)",
          WebkitTransition: "rotateY(180deg)",
        }}
      />
      {/* <canvas ref={canvasRef} /> */}
      {!loaded && (
        <Loading>
          <div className="spinner"></div>
          <div className="message">Loading</div>
        </Loading>
      )}
    </PoseContainer>
  );
};

export default MediaPipe;
