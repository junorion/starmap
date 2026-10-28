package com.junorion.starmap;

import android.content.Context;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.util.SizeF;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/**
 * 웹에 window.StarmapNative 로 붙는 연결. 웹 표준에 없는 것만 알려 준다.
 *
 * AR 모드는 카메라 영상과 기기 방향을 웹 API 로 받지만, 카메라의 화각은 웹에서 알 수 없다.
 * 화각을 모르면 겹쳐 그린 별자리의 크기가 실제 하늘과 어긋나므로 여기서 계산해 준다.
 *
 * addJavascriptInterface 는 리플렉션으로 메서드를 부르므로 최상위 public 클래스로 둔다.
 */
public final class NativeBridge {

    private final Context context;

    public NativeBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    /**
     * 첫 후면 카메라의 화각(도)을 {"long":…,"short":…} JSON 으로 돌려준다. 센서의 긴 변·짧은 변 기준이다.
     * 알 수 없으면 빈 문자열을 돌려주고, 웹은 기본값을 쓴다. 카메라 권한 없이 읽을 수 있는 정보다.
     */
    @JavascriptInterface
    public String cameraFov() {
        try {
            CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (manager == null) return "";
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics info = manager.getCameraCharacteristics(id);
                Integer facing = info.get(CameraCharacteristics.LENS_FACING);
                if (facing == null || facing != CameraCharacteristics.LENS_FACING_BACK) continue;
                float[] focal = info.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
                SizeF sensor = info.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
                if (focal == null || focal.length == 0 || focal[0] <= 0 || sensor == null) continue;
                double longSide = Math.max(sensor.getWidth(), sensor.getHeight());
                double shortSide = Math.min(sensor.getWidth(), sensor.getHeight());
                return String.format(Locale.US, "{\"long\":%.2f,\"short\":%.2f}",
                        fovDegrees(longSide, focal[0]), fovDegrees(shortSide, focal[0]));
            }
        } catch (Exception ignored) {
            // 카메라 정보를 읽지 못하면 웹이 기본 화각을 쓴다.
        }
        return "";
    }

    private static double fovDegrees(double sensorMm, double focalMm) {
        return Math.toDegrees(2 * Math.atan(sensorMm / (2 * focalMm)));
    }
}
