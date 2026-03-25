import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const body = await request.json();
    const prompt = body.prompt as string;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Save user message
    await db.taskMessage.create({
      data: {
        role: "USER",
        content: prompt,
        taskId,
      },
    });

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          // For now, simulate a response since we need a running agent process
          // In production, this would spawn AgentRunner and stream its output
          sendEvent({
            type: "status",
            content: "Agent started",
          });

          // Simulate agent thinking
          sendEvent({
            type: "message",
            content: `正在分析任务...\n\n收到指令: "${prompt}"`,
          });

          // Save assistant message to DB
          await db.taskMessage.create({
            data: {
              role: "ASSISTANT",
              content: `正在分析任务...\n\n收到指令: "${prompt}"\n\n(AI 代理实时流式响应开发中)`,
              taskId,
            },
          });

          sendEvent({
            type: "status",
            content: "completed",
          });
        } catch (error) {
          sendEvent({
            type: "error",
            content: "Agent execution failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Stream failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
