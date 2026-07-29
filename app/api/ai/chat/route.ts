import OpenAI from "openai";
import { NextResponse } from "next/server";

const ai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export async function POST(request: Request) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is missing." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const message = body.message;

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "A message is required." },
        { status: 400 }
      );
    }

    const completion = await ai.chat.completions.create({
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: message.trim(),
        },
      ],
    });

    return NextResponse.json({
      response:
        completion.choices[0]?.message?.content ??
        "The model returned no response.",
      model: completion.model,
    });
  } catch (error) {
    console.error("OpenRouter error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate response.",
      },
      { status: 500 }
    );
  }
}