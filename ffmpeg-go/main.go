package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type VideoRequest struct {
	AudioFile string   `json:"audio_file" form:"audio_file"`
	Images    []string `json:"images" form:"images"`
	Duration  float64  `json:"duration" form:"duration"`
}

type VideoResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	VideoURL string `json:"video_url,omitempty"`
	Filename string `json:"filename,omitempty"`
}

var minioClient *minio.Client

func initMinio() {
	endpoint := os.Getenv("MINIO_URL")
	accessKeyID := os.Getenv("MINIO_ACCESS_KEY")
	secretAccessKey := os.Getenv("MINIO_SECRET_KEY")
	useSSL := os.Getenv("MINIO_USE_SSL") == "true"

	if endpoint == "" {
		endpoint = "localhost:9000"
	}
	if accessKeyID == "" {
		accessKeyID = "minioadmin"
	}
	if secretAccessKey == "" {
		secretAccessKey = "minioadmin123"
	}

	var err error
	minioClient, err = minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		log.Printf("MinIO connection failed: %v", err)
		minioClient = nil
	} else {
		log.Println("MinIO client initialized successfully")
	}
}

// getAudioDuration gets the duration of an audio file using ffprobe
func getAudioDuration(audioPath string) (float64, error) {
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "csv=p=0",
		audioPath,
	)

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("failed to get audio duration: %v", err)
	}

	durationStr := strings.TrimSpace(string(output))
	duration, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration: %v", err)
	}

	return duration, nil
}

func createVideoFromAudioAndImages(audioPath string, imagePaths []string, outputPath string) error {
	if len(imagePaths) == 0 {
		return fmt.Errorf("no images provided")
	}

	// Get audio duration
	audioDuration, err := getAudioDuration(audioPath)
	if err != nil {
		return fmt.Errorf("error getting audio duration: %v", err)
	}

	// Calculate duration per image
	durationPerImage := audioDuration / float64(len(imagePaths))
	framesPerImage := int(durationPerImage * 30) // 30 fps

	// Create individual video segments for each image with zoom effect
	var videoSegments []string
	
	for i, imagePath := range imagePaths {
		segmentPath := fmt.Sprintf("/tmp/segment_%d.mp4", i)
		videoSegments = append(videoSegments, segmentPath)
		
		// Create zoom effect for each image individually
		zoomCmd := exec.Command("ffmpeg",
			"-loop", "1",
			"-i", imagePath,
			"-t", fmt.Sprintf("%.2f", durationPerImage),
			"-vf", fmt.Sprintf(
				"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"+
				"zoompan=z='min(1+0.002*on,1.3)':d=%d:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30",
				framesPerImage,
			),
			"-c:v", "libx264",
			"-pix_fmt", "yuv420p",
			"-preset", "medium",
			"-crf", "23",
			"-y",
			segmentPath,
		)
		
		if err := zoomCmd.Run(); err != nil {
			// Clean up created segments
			for _, segment := range videoSegments {
				os.Remove(segment)
			}
			return fmt.Errorf("error creating video segment %d: %v", i, err)
		}
	}
	
	// Create concat file for video segments
	videoConcatFile := "/tmp/video_concat.txt"
	file, err := os.Create(videoConcatFile)
	if err != nil {
		return err
	}
	defer file.Close()
	defer os.Remove(videoConcatFile)
	
	// Write video segment paths to concat file
	for _, segment := range videoSegments {
		_, err := file.WriteString(fmt.Sprintf("file '%s'\n", segment))
		if err != nil {
			return err
		}
	}
	
	// Combine all video segments and add audio
	finalCmd := exec.Command("ffmpeg",
		"-f", "concat",
		"-safe", "0",
		"-i", videoConcatFile,
		"-i", audioPath,
		"-c:v", "copy", // Copy video (already encoded)
		"-c:a", "aac",
		"-shortest",
		"-movflags", "+faststart",
		"-y",
		outputPath,
	)
	
	output, err := finalCmd.CombinedOutput()
	if err != nil {
		// Clean up
		for _, segment := range videoSegments {
			os.Remove(segment)
		}
		return fmt.Errorf("ffmpeg final merge error: %v, output: %s", err, string(output))
	}
	
	// Clean up temporary files
	for _, segment := range videoSegments {
		os.Remove(segment)
	}
	return nil
}

func uploadToMinio(filePath, fileName string) (string, error) {
	if minioClient == nil {
		return "", fmt.Errorf("MinIO client not initialized")
	}

	bucketName := "media"

	// Create bucket if it doesn't exist
	ctx := context.Background()
	exists, err := minioClient.BucketExists(ctx, bucketName)
	if err != nil {
		return "", err
	}

	if !exists {
		err = minioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
		if err != nil {
			return "", err
		}
	}

	// Upload file
	_, err = minioClient.FPutObject(ctx, bucketName, fileName, filePath, minio.PutObjectOptions{
		ContentType: "video/mp4",
	})
	if err != nil {
		return "", err
	}

	// Generate presigned URL for download (24 hours)
	url, err := minioClient.PresignedGetObject(ctx, bucketName, fileName, 24*time.Hour, nil)
	if err != nil {
		return "", err
	}

	return url.String(), nil
}

func createVideo(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(VideoResponse{
			Success: false,
			Message: "Failed to parse form data",
		})
	}

	contentID := c.FormValue("contentId")
	if contentID == "" {
		return c.Status(400).JSON(VideoResponse{
			Success: false,
			Message: "contentId is required",
		})
	}

	// Get audio file
	audioFiles := form.File["audio"]
	if len(audioFiles) == 0 {
		return c.Status(400).JSON(VideoResponse{
			Success: false,
			Message: "Audio file is required",
		})
	}

	// Get image files
	imageFiles := form.File["images"]
	if len(imageFiles) == 0 {
		return c.Status(400).JSON(VideoResponse{
			Success: false,
			Message: "At least one image is required",
		})
	}

	// Create temporary directory
	tempDir := fmt.Sprintf("/tmp/video_%d", time.Now().Unix())
	os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	// Save audio file
	audioFile := audioFiles[0]
	audioPath := filepath.Join(tempDir, audioFile.Filename)
	if err := c.SaveFile(audioFile, audioPath); err != nil {
		return c.Status(500).JSON(VideoResponse{
			Success: false,
			Message: "Failed to save audio file",
		})
	}

	// Save image files
	var imagePaths []string
	for i, imageFile := range imageFiles {
		imagePath := filepath.Join(tempDir, fmt.Sprintf("image_%d_%s", i, imageFile.Filename))
		if err := c.SaveFile(imageFile, imagePath); err != nil {
			return c.Status(500).JSON(VideoResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to save image file: %s", imageFile.Filename),
			})
		}
		imagePaths = append(imagePaths, imagePath)
	}

	// Create output video
	outputFilename := fmt.Sprintf("video_%d.mp4", time.Now().Unix()) // hanya nama file
	outputPath := filepath.Join(tempDir, outputFilename)

	err = createVideoFromAudioAndImages(audioPath, imagePaths, outputPath)
	if err != nil {
		return c.Status(500).JSON(VideoResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to create video: %v", err),
		})
	}

	// Upload to MinIO if available
	var videoURL string
	if minioClient != nil {
		videoURL, err = uploadToMinio(outputPath, fmt.Sprintf("%s/%s", contentID, outputFilename))
		if err != nil {
			log.Printf("Failed to upload to MinIO: %v", err)
			// Continue without MinIO upload
		}
	}

	response := VideoResponse{
		Success:  true,
		Message:  "Video created successfully",
		Filename: outputFilename,
	}

	if videoURL != "" {
		response.VideoURL = videoURL
	}

	return c.JSON(response)
}

func healthCheck(c *fiber.Ctx) error {
	// Check FFmpeg
	_, err := exec.LookPath("ffmpeg")
	ffmpegStatus := err == nil

	// Check MinIO
	minioStatus := minioClient != nil

	return c.JSON(fiber.Map{
		"status":  "ok",
		"ffmpeg":  ffmpegStatus,
		"minio":   minioStatus,
		"message": "API is running",
	})
}

func main() {
	// Initialize MinIO
	initMinio()

	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB
	})

	// Middleware
	app.Use(logger.New())
	app.Use(cors.New())

	// Routes
	app.Get("/health", healthCheck)
	app.Post("/create-video", createVideo)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
