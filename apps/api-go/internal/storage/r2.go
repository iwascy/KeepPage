package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
)

type R2 struct {
	client *s3.Client
	bucket string
}

func NewR2(cfg config.Config) (*R2, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(
		context.Background(),
		awsconfig.WithRegion(cfg.R2Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("load R2 configuration: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(strings.TrimRight(cfg.R2Endpoint, "/"))
		options.UsePathStyle = true
	})
	return &R2{client: client, bucket: cfg.R2Bucket}, nil
}

func (s *R2) StatObject(ctx context.Context, key string) (ObjectInfo, error) {
	output, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		if isObjectNotFound(err) {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: key, Size: aws.ToInt64(output.ContentLength)}, nil
}

func (s *R2) PutObject(ctx context.Context, key string, content []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(content),
		ContentType: aws.String(contentType),
	})
	return err
}

func (s *R2) GetObject(ctx context.Context, key string) ([]byte, error) {
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		if isObjectNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	defer output.Body.Close()
	return io.ReadAll(output.Body)
}

func (s *R2) DeleteObject(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	return err
}

func isObjectNotFound(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "notfound") || strings.Contains(message, "not found") || strings.Contains(message, "status code: 404")
}
